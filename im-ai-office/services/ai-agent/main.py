#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ai-agent：消费 Redis Streams(msg) → 意图判定 → 归属消歧 → 落库 Postgres。

真实 docker 全栈闭环：OpenIM回调(或模拟) → Redis msg 流 → 本服务 → Postgres task。
识别/消歧复用真实 LLM(通过 llm_provider)。
"""
import os
import re
import json
import asyncio
from typing import Optional

import redis
import psycopg

from llm_provider import LLMProvider
import openim_client

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://imai:imai_secret@localhost:5432/imai")
STREAM = "msg"
GROUP = "ai-agent"
CONSUMER = "c1"

INTENT_SCHEMA = {
    "is_task": "boolean", "confidence": "high|medium|low",
    "content": "string", "assignee_hint": "string|nullable",
    "deadline_hint": "string|nullable", "assign_mode": "assigned|self|third_party|none",
}


def to_bool(v):
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() == "true"


def get_conn():
    return psycopg.connect(DATABASE_URL)


def ensure_seed(conn):
    """首次跑时插入人员+别名（制造『两个小张』消歧场景）。"""
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM person")
        if cur.fetchone()[0] == 0:
            cur.executemany(
                "INSERT INTO person(id, real_name, flower_name, title, group_id) VALUES(%s,%s,%s,%s,%s)",
                [(1, "张伟", "小张", "产品经理", 100), (2, "张敏", "小张", "市场专员", 100), (3, "李娜", "娜姐", "运营", 100)],
            )
            cur.executemany(
                "INSERT INTO alias(person_id, name) VALUES(%s,%s)",
                [(1, "小张"), (1, "张伟"), (2, "小张"), (3, "娜姐")],
            )
        conn.commit()


def mock_intent(msg):
    """规则回退识别（LLM 不可用时的 mock）：识别少量典型任务。"""
    # 截止提取：周五前/下周X/X天后/明天
    deadline = None
    for pat in (r"[^，,。\s]*前", r"下周[一二三四五]", r"[^，,。\s]*后"):
        m = re.search(pat, msg)
        if m:
            deadline = m.group(0)
            break
    # 认领（self）
    if re.search(r"我来|我负责|我搞定|认领这", msg):
        return {"is_task": True, "confidence": "high", "content": msg, "assignee_hint": "我",
                "deadline_hint": deadline, "assign_mode": "self"}
    # 明确指派（assigned）
    if re.search(r"你来|你负责|跟进一下|@小张|小张 ", msg):
        return {"is_task": True, "confidence": "high", "content": msg, "assignee_hint": "小张",
                "deadline_hint": deadline, "assign_mode": "assigned"}
    return {"is_task": False, "confidence": "low", "content": "", "assignee_hint": None, "deadline_hint": None, "assign_mode": "none"}


def load_memory(conn, grp_id):
    """读当前群的团队记忆，拼 thành 注入上下文（只注入当前群）。"""
    parts = []
    try:
        with conn.cursor() as cur:
            # 群简介
            cur.execute("SELECT intro FROM grp WHERE oim_group_id=%s LIMIT 1", (str(grp_id),))
            row = cur.fetchone()
            if row and row[0]:
                parts.append(f"群简介：{row[0]}")
            # 术语
            cur.execute("SELECT term, meaning FROM term WHERE grp_id=(SELECT id FROM grp WHERE oim_group_id=%s)", (str(grp_id),))
            terms = cur.fetchall()
            if terms:
                parts.append("团队术语：" + "；".join(f"{t[0]}={t[1]}" for t in terms))
    except Exception as e:
        print(f"[memory] load error: {e}")
    return "\n".join(parts)


def memory_capture(conn, text, grp_id=None, actor=None):
    """修正信号识别：从用户纠正/驳回原因提取术语记忆，沉淀到 term + audit。
    规则识别（LLM 缺配额）；低置信不自动写入。
    """
    # 需要群 id
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM grp WHERE oim_group_id=%s LIMIT 1", (str(grp_id),))
        row = cur.fetchone()
        grp_pk = row[0] if row else None
    if not grp_pk:
        return {"captured": False, "reason": "群不存在"}

    # 规则：提取术语定义（支持 "X 指的是 Y" / "X 不是 A，指的是 Y" / "X 就是 Y"）
    term = meaning = None
    # 定位 meaning（"指的是/就是/是指"后面）
    m_mean = re.search(r"指的是|就是指|就是|是指|叫做", text)
    if m_mean:
        # term："指的是"前 2-8 字的术语词（允许跨逗号，非贪婪）
        m_term = re.search(r"([\u4e00-\u9fa5]{2,8}).{0,20}?" + re.escape(m_mean.group(0)), text)
        if m_term:
            term = m_term.group(1)
        # meaning："指的是"后 2-40 字
        m_after = re.search(re.escape(m_mean.group(0)) + r"([\u4e00-\u9fa5（）()，,。]{2,40})", text)
        if m_after:
            meaning = m_after.group(1)
    if not (term and meaning):
        return {"captured": False, "reason": "未识别到明确术语定义"}
    meaning = meaning.rstrip("。，, ")
    # 沉淀（去重：同群同术语存在则不重复写）
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM term WHERE grp_id=%s AND term=%s", (grp_pk, term))
        exists = cur.fetchone()
        if not exists:
            cur.execute("INSERT INTO term(grp_id, term, meaning) VALUES(%s,%s,%s)", (grp_pk, term, meaning))
        # audit 留痕
        cur.execute("INSERT INTO audit(actor,action,detail) VALUES(%s,'memorize',%s)",
                    (actor or "user", json.dumps({"term": term, "meaning": meaning}, ensure_ascii=False)))
    conn.commit()
    return {"captured": True, "term": term, "meaning": meaning}


def intent_detect(llm: LLMProvider, msg: str, sys_ctx: str = ""):
    system = (
        "你是办公群聊里的任务识别助手。只在消息确实安排/认领任务时 is_task=true。"
        "分清：明确指派(@某人或'你负责')=assigned；主动认领('我来')=self；第三人称指派='third_party'；无归属=none。"
        "不要臆断。输出严格JSON：" + json.dumps(INTENT_SCHEMA, ensure_ascii=False)
    )
    if sys_ctx:
        system += "\n" + sys_ctx
    try:
        return llm.structured(system, "判断这条群聊消息是否在安排任务；是则提取内容/负责人/截止：\n消息：" + msg, INTENT_SCHEMA)
    except Exception as e:
        print(f"[intent] LLM error({e.__class__.__name__})，回退规则识别")
        return mock_intent(msg)


def resolve(conn, msg, sender="李娜(娜姐)", intent=None):
    mode = (intent or {}).get("assign_mode", "none")
    if mode == "self":
        return {"assignee": sender, "confidence": "high", "ambiguous": False}
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT name FROM alias")
        names = [r[0] for r in cur.fetchall()]
    hits = []
    for n in names:
        if n and n in msg:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT p.id, p.real_name, p.flower_name FROM alias a JOIN person p ON p.id=a.person_id WHERE a.name=%s",
                    (n,),
                )
                hits.extend(cur.fetchall())
    seen, uniq = set(), []
    for h in hits:
        if h[0] not in seen:
            seen.add(h[0]); uniq.append(h)
    if len(uniq) == 0:
        return {"assignee": (intent or {}).get("assignee_hint"), "confidence": "low", "ambiguous": False}
    if len(uniq) == 1:
        return {"assignee": uniq[0][1] + "/" + (uniq[0][2] or ""), "confidence": "high", "ambiguous": False}
    return {"assignee": None, "confidence": "medium", "ambiguous": True,
            "labels": [{"id": r[0], "label": f"{r[1]}({r[2]})"} for r in uniq]}


def persist_task(conn, content, sender, assignee, deadline, confidence, source_msg):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO task(content, creator, assignee, deadline, status, confidence, source_msg)"
            " VALUES(%s,%s,%s,%s,'pending_confirmation',%s,%s) RETURNING id",
            (content, sender, assignee, deadline, confidence, source_msg),
        )
        task_id = cur.fetchone()[0]
        conn.commit()
    return task_id


def handle(event: dict, llm: LLMProvider, conn):
    msg = event.get("content", "")
    sender = event.get("senderId") or "李娜(娜姐)"
    grp_id = str(event.get("grpId") or "").strip()
    print(f"[msg] {msg}  (sender={sender})")

    # 团队记忆注入：当前群 群简介/术语
    sys_ctx = load_memory(conn, grp_id)
    intent = intent_detect(llm, msg, sys_ctx)
    print(f"  intent: is_task={intent.get('is_task')} conf={intent.get('confidence')} mode={intent.get('assign_mode')}")
    if not to_bool(intent.get("is_task")):
        # 非任务：检查是否含修正信号（用户纠正），可沉淀团队记忆
        if grp_id and re.search(r"不是|其实|应该叫|指的是|就是", msg):
            cap = memory_capture(conn, msg, grp_id=grp_id, actor=sender)
            print(f"  -> 修正信号: {cap}")
        print("  -> 非任务，静默跳过")
        return

    assign = resolve(conn, msg, sender, intent)
    if assign.get("ambiguous"):
        print(f"  -> 歧义多个候选，需私聊发送者确认: {assign.get('labels')}")
        return  # 正版：私聊确认后落库

    content = intent.get("content") or msg
    assignee = assign.get("assignee") or "待指派"
    deadline = intent.get("deadline_hint")
    task_id = persist_task(conn, content, sender, assignee, deadline, intent.get("confidence"), msg)
    print(f"  -> 落库 task#{task_id}: {content[:30]} | 负责人={assignee} | 截止={deadline}")

    # 组确认卡并发送：群聊优先（消息带 grpId），否则单聊给发送者
    card = {"ai_confirm_card": {
        "taskId": task_id,
        "content": content,
        "assignee": assignee,
        "deadline": deadline,
    }}
    grp_id = str(event.get("grpId") or "").strip()
    try:
        resp = openim_client.send_confirm_card(
            recv_id=sender, card_json=json.dumps(card, ensure_ascii=False),
            group_id=(grp_id or None), send_id="5287597439",
        )
        ok = (resp or {}).get("errCode") == 0
        target = f"群 {grp_id}" if grp_id else f"私聊 {sender}"
        print(f"  -> 已发确认卡到 {target}: ok={ok}")
    except Exception as e:
        print(f"  -> 发送确认卡失败: {e}")


async def consume():
    llm = LLMProvider()
    conn = get_conn()
    ensure_seed(conn)
    r = redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=None, socket_connect_timeout=5)
    try:
        r.xgroup_create(STREAM, GROUP, id="0", mkstream=True)
    except redis.exceptions.ResponseError:
        pass
    print(f"[ai-agent] consume '{STREAM}' (group={GROUP})")
    while True:
        streams = r.xreadgroup(GROUP, CONSUMER, {STREAM: ">"}, count=10, block=5000)
        for _, items in streams:
            for msg_id, fields in items:
                try:
                    handle(fields, llm, conn)
                except Exception as e:
                    print("[handle] error:", e)
                r.xack(STREAM, GROUP, msg_id)


if __name__ == "__main__":
    try:
        asyncio.run(consume())
    except KeyboardInterrupt:
        print("stopped")
