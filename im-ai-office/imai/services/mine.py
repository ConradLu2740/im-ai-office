#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""B4 历史消息挖掘服务（Spec：B4历史挖掘Spec.md）

- run_mining：本地 message 表按 conv_id 取最近 N 条 → 分批 → llm.py 锚点批量提取
  术语/别名/遗漏任务 → 统一落 mine_candidate 候选池（重复置 duplicate），零直接入库
- decide_candidate：accept 按 kind 分发入库（term source='mined' / person+alias /
  pending_confirmation 任务）；reject 仅置状态。全程 audit。
与实时 pipeline 的本质区别：挖掘只产候选，无确认卡/私聊/提醒等任何外发副作用。
"""
import json
from datetime import datetime, timezone

from imai.db import take_id
from imai.repos import audit_log, insert_task
from imai.services.memory import add_term

MINE_SYSTEM = (
    '你是办公群聊的知识挖掘助手。输入是一段按时间排列的群聊记录片段。'
    '请从聊天记录里提取三类信息，输出 JSON：'
    '{"terms":[{"term":术语,"meaning":含义}],'
    '"aliases":[{"real_name":正名,"alias":称呼/花名/外号}],'
    '"tasks":[{"content":待办事项,"assignee_hint":负责人(原文提及或null),'
    '"deadline_hint":截止时间(原文提及或null)}],'
    '"evidence":{"term":原文摘录,"alias":原文摘录,"task":原文摘录}}。'
    '只提取聊天记录里真实出现的内容，不要编造；某类没有就给空数组。'
    'evidence 各项给最有代表性的一句原文（没有则 null）。只输出 JSON。'
)


def _utcnow():
    return datetime.now(timezone.utc).isoformat()


def _llm():
    """LLM 统一经 imai/llm.py 锚点调用（DX Spec D3 契约）。"""
    from imai import llm
    return llm.get_llm()


def _loads(v):
    try:
        return json.loads(v) if v else None
    except (ValueError, TypeError):
        return None


def _dumps(v):
    return json.dumps(v, ensure_ascii=False)


def _insert_candidate(con, conv_id, kind, payload, evidence, msg_count, status="pending"):
    c = con.cursor()
    c.execute("INSERT INTO mine_candidate(conv_id, kind, payload, evidence, msg_count, status) "
              "VALUES(?,?,?,?,?,?)",
              (conv_id, kind, _dumps(payload), evidence, msg_count, status))
    cid = take_id(c)
    con.commit()
    return cid


def _term_exists(con, term):
    c = con.cursor()
    c.execute("SELECT 1 FROM term WHERE term=?", (term,))
    return bool(c.fetchone())


def _alias_exists(con, real_name, alias):
    c = con.cursor()
    c.execute("SELECT 1 FROM alias a JOIN person p ON a.person_id=p.id "
              "WHERE p.real_name=? AND a.name=?", (real_name, alias))
    return bool(c.fetchone())


def _extract_batch(con, conv_id, rows, stats):
    """一批消息 → LLM 提取 → 落候选。LLM 失败跳过该批（计数），不中断。"""
    lines = [f"【{r['ts']}】{r['sender_name']}：{r['content']}" for r in rows]
    transcript = "\n".join(lines)
    try:
        data = json.loads(_llm()(MINE_SYSTEM, transcript, json_mode=True))
    except (ValueError, TypeError):
        stats["skipped_batches"] += 1
        return
    ev = data.get("evidence") or {}
    for t in data.get("terms") or []:
        term, meaning = str(t.get("term") or "").strip(), str(t.get("meaning") or "").strip()
        if not term:
            continue
        status = "duplicate" if _term_exists(con, term) else "pending"
        _insert_candidate(con, conv_id, "term", {"term": term, "meaning": meaning},
                          str(ev.get("term") or ""), len(rows), status)
        stats["by_kind"]["term"] += 1
    for a in data.get("aliases") or []:
        real, alias = str(a.get("real_name") or "").strip(), str(a.get("alias") or "").strip()
        if not real or not alias:
            continue
        status = "duplicate" if _alias_exists(con, real, alias) else "pending"
        _insert_candidate(con, conv_id, "alias", {"real_name": real, "alias": alias},
                          str(ev.get("alias") or ""), len(rows), status)
        stats["by_kind"]["alias"] += 1
    for t in data.get("tasks") or []:
        content = str(t.get("content") or "").strip()
        if not content:
            continue
        _insert_candidate(con, conv_id, "task",
                          {"content": content, "assignee_hint": t.get("assignee_hint"),
                           "deadline_hint": t.get("deadline_hint")},
                          str(ev.get("task") or ""), len(rows))
        stats["by_kind"]["task"] += 1


def run_mining(con, conv_id, limit=500, batch=100):
    """挖掘入口。会话无消息抛 ValueError('no_messages')。"""
    c = con.cursor()
    c.execute("SELECT * FROM (SELECT * FROM message WHERE conv_id=? ORDER BY id DESC LIMIT ?) t "
              "ORDER BY id ASC", (conv_id, int(limit)))
    rows = c.fetchall()
    if not rows:
        raise ValueError("no_messages")
    stats = {"skipped_batches": 0, "by_kind": {"term": 0, "alias": 0, "task": 0}}
    step = max(1, min(int(batch), 500))
    for i in range(0, len(rows), step):
        _extract_batch(con, conv_id, rows[i:i + step], stats)
    audit_log(con, "user", "mine_run",
              {"convId": conv_id, "msgCount": len(rows), "batches": -(-len(rows) // step),
               "skippedBatches": stats["skipped_batches"], "byKind": stats["by_kind"]})
    return {"total": sum(stats["by_kind"].values()), "skipped_batches": stats["skipped_batches"],
            "by_kind": stats["by_kind"]}


def _row_to_dict(row):
    d = dict(row)
    d["payload"] = _loads(d.get("payload")) or {}
    return d


def list_candidates(con, status="pending", kind=None):
    sql, params = "SELECT * FROM mine_candidate", []
    conds = []
    if status:
        conds.append("status=?")
        params.append(status)
    if kind:
        conds.append("kind=?")
        params.append(kind)
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY id DESC"
    c = con.cursor()
    c.execute(sql, tuple(params))
    return [_row_to_dict(r) for r in c.fetchall()]


def _accept(con, cand):
    kind, payload = cand["kind"], cand["payload"]  # _row_to_dict 已反序列化
    if kind == "term":
        add_term(con, payload["term"], payload.get("meaning") or "", source="mined")
        result = {"term": payload["term"]}
    elif kind == "alias":
        c = con.cursor()
        real, alias = payload["real_name"], payload["alias"]
        c.execute("SELECT id FROM person WHERE real_name=? ORDER BY id DESC LIMIT 1", (real,))
        row = c.fetchone()
        if row:
            pid = row["id"] if not isinstance(row, dict) else row["id"]
        else:
            c.execute("INSERT INTO person(real_name) VALUES(?) RETURNING id", (real,))
            pid = take_id(c)
        c.execute("SELECT 1 FROM alias WHERE person_id=? AND name=?", (pid, alias))
        if not c.fetchone():
            c.execute("INSERT INTO alias(person_id, name) VALUES(?,?)", (pid, alias))
        con.commit()
        result = {"personId": pid, "alias": alias}
    elif kind == "task":
        tid = insert_task(con, payload["content"], f"mine#{cand['id']}",
                          payload.get("assignee_hint"), payload.get("deadline_hint"),
                          "pending_confirmation", "medium", cand["evidence"] or "")
        result = {"taskId": tid}
    else:
        raise ValueError("bad_kind")
    return result


def decide_candidate(con, cid, action):
    """候选决定。不存在返回 None；非 pending 或非法 action 抛 ValueError。"""
    c = con.cursor()
    c.execute("SELECT * FROM mine_candidate WHERE id=?", (cid,))
    row = c.fetchone()
    if not row:
        return None
    cand = _row_to_dict(row)
    if action not in ("accept", "reject"):
        raise ValueError("bad_action")
    if cand["status"] != "pending":
        raise ValueError("already_decided")
    result = _accept(con, cand) if action == "accept" else {}
    c.execute("UPDATE mine_candidate SET status=?, decided_at=?, decided_by='user' WHERE id=?",
              ("accepted" if action == "accept" else "rejected", _utcnow(), cid))
    con.commit()
    audit_log(con, "user", "mine_accepted" if action == "accept" else "mine_rejected",
              {"candidateId": cid, "kind": cand["kind"], **result})
    return {"id": cid, "status": "accepted" if action == "accept" else "rejected", "result": result}
