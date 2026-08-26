#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
对话式 AI 办公 · MVP 最小闭环 demo
=================================
在无 docker/postgres/redis 的受限环境里，用最小依赖跑通产品核心链路：

  群消息 → 意图判定(LLM) → 归属判定(别名消歧) → 任务落库 → 人审确认 → 看板 → 提醒

依赖：
- Python 标准库（urllib 调 LLM、sqlite3 持久化、json/datetime）
- Proma Cloud LLM（OpenAI 兼容 /v1/chat/completions）

真实基础设施（postgres/redis/docker/openim）在正式环境部署；本 demo 验证的是【AI 业务逻辑正确性】。
"""
import json
import sqlite3
import time
import urllib.request

# ============ 配置 ============
LLM_BASE = "https://api.proma.cool/v1"
LLM_API_KEY = "pk_euFtejthZLAsE5uUWElxu8SsJzhHOgYWhCX5kps9swF"
LLM_MODEL = "deepseek-v4-flash"  # fast/中文/便宜，适合识别任务
DB_FILE = "/tmp/imai_demo.db"

# ============ 1. 数据层（SQLite，模拟 Postgres schema 的子集）============
def init_db():
    con = sqlite3.connect(DB_FILE)
    c = con.cursor()
    c.executescript("""
    DROP TABLE IF EXISTS person; DROP TABLE IF EXISTS alias;
    DROP TABLE IF EXISTS task; DROP TABLE IF EXISTS audit;
    CREATE TABLE person(id INTEGER PRIMARY KEY, real_name TEXT, flower_name TEXT, title TEXT, group_id INTEGER);
    CREATE TABLE alias(person_id INTEGER, name TEXT);
    CREATE TABLE task(id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, creator TEXT,
                      assignee TEXT, deadline TEXT, status TEXT, confidence TEXT);
    CREATE TABLE audit(actor TEXT, action TEXT, detail TEXT, ts TEXT);
    """)
    # 种子：制造「两个小张」消歧场景
    c.executemany("INSERT INTO person VALUES(?,?,?,?,?)", [
        (1, "张伟", "小张", "产品经理", 100),
        (2, "张敏", "小张", "市场专员", 100),
        (3, "李娜", "娜姐", "运营", 100),
    ])
    c.executemany("INSERT INTO alias VALUES(?,?)", [(1, "小张"), (1, "张伟"), (2, "小张"), (2, "张敏"), (3, "娜姐")])
    con.commit()
    return con


# ============ 2. LLM 意图判定（Proma Cloud · OpenAI 兼容）============
def llm_chat(system, user, json_mode=True):
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "max_tokens": 1024,  # 推理模型留足
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(
        f"{LLM_BASE}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        data = json.loads(resp.read().decode())
    return data["choices"][0]["message"]["content"]


def intent_detect(msg, sys_ctx=""):
    schema = {
        "is_task": "boolean", "confidence": "high|medium|low",
        "content": "string", "assignee_hint": "string|nullable(用'我'表示说话人)",
        "deadline_hint": "string|nullable", "assign_mode": "assigned|self|third_party|none",
    }
    system = (
        "你是办公群聊里的任务识别助手。只在消息确实安排/认领任务时 is_task=true。"
        "分清：明确指派(@某人或'你负责')=assigned；主动认领('我来')=self；第三人称指派('让小张跟一下')=third_party；无归属=none。"
        "不要臆断。输出严格JSON：" + json.dumps(schema, ensure_ascii=False)
    )
    if sys_ctx:
        system += "\n" + sys_ctx
    raw = llm_chat(system, "判断这条群聊消息是否在安排任务；是则提取内容/负责人/截止：\n消息：" + msg)
    try:
        return json.loads(raw)
    except Exception:
        return {"is_task": False, "confidence": "low", "raw": raw}


# ============ 3. 归属判定（别名消歧）============
def to_bool(v):
    """LLM json 可能返回字符串 'true'/'false'，需规范化。"""
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() == "true"


# ============ 3. 归属判定（别名消歧 + 认领模式）============
def find_by_alias(con, name):
    c = con.cursor()
    c.execute("SELECT p.id, p.real_name, p.flower_name FROM alias a JOIN person p ON p.id=a.person_id WHERE a.name=?", (name,))
    return c.fetchall()


def resolve(con, msg, sender="李娜(娜姐)", intent=None):
    """结合意图判定结果做归属：
    - self 认领 -> 说话人
    - assigned/third_party -> 用别名声消歧（可能歧义）
    - 无命中 -> 用 assignee_hint 或 None
    """
    mode = (intent or {}).get("assign_mode", "none")
    if mode == "self":
        return {"assignee": sender, "confidence": "high", "candidates": [], "mode": mode}

    c = con.cursor()
    c.execute("SELECT DISTINCT name FROM alias")
    names = [r[0] for r in c.fetchall()]
    hits = []
    for n in names:
        if n and n in msg:
            hits.extend(find_by_alias(con, n))
    seen, uniq = set(), []
    for h in hits:
        if h[0] not in seen:
            seen.add(h[0]); uniq.append(h)
    if len(uniq) == 0:
        hint = (intent or {}).get("assignee_hint")
        return {"assignee": hint or None, "confidence": "low", "candidates": [], "mode": mode}
    if len(uniq) == 1:
        return {"assignee": uniq[0][1] + "/" + (uniq[0][2] or ""), "confidence": "high", "candidates": uniq, "mode": mode}
    # 多个同名 -> 歧义，需私聊确认
    return {"assignee": None, "confidence": "medium", "candidates": uniq, "mode": mode}


# ============ 4. 主流程：跑一条消息 ============
def run_message(con, msg):
    print("\n" + "=" * 56)
    print(f"📩 收到消息：{msg}")
    # 意图判定
    intent = intent_detect(msg)
    print(f"  🤖 意图判定: is_task={intent.get('is_task')} confidence={intent.get('confidence')} mode={intent.get('assign_mode')}")
    if not to_bool(intent.get("is_task")):
        print("  → 非任务，静默不进看板 ✅")
        return

    # 归属判定（别名消歧 + 认领模式）
    assign = resolve(con, msg, intent=intent)
    cands = assign["candidates"]
    print(f"  👤 归属判定: confidence={assign['confidence']} assignee={assign['assignee']}")

    if assign["confidence"] == "medium" and len(cands) > 1:
        labels = " / ".join(f"{r[1]}({r[2]})" for r in cands)
        print(f"  ⚠️ 存在多个同名候选：{labels}")
        print(f"  → 【私聊发送者确认】到底是哪一个？（低打扰，不进群）")
        chosen = cands[0]  # demo：默认选第一个，实际由发送者点选
        assignee = chosen[1] + "/" + (chosen[2] or "")
        print(f"  ✅ 发送者确认 → assignee={assignee}")
    else:
        assignee = assign["assignee"] or "待指派"

    content = intent.get("content") or msg
    deadline = intent.get("deadline_hint")
    # 落库
    c = con.cursor()
    c.execute("INSERT INTO task(content,creator,assignee,deadline,status,confidence) VALUES(?,?,?,?,?,?)",
              (content, "李娜(娜姐)", assignee, deadline, "pending_confirmation", intent.get("confidence")))
    con.commit()
    task_id = c.lastrowid
    print(f"  📋 任务已落库 (#{task_id})：{content[:30]} | 负责人={assignee} | 截止={deadline}")

    # 人审确认
    print(f"  → 【人审】发送人确认：[确认] / [驳回] / [修改]（demo 取 [确认]）")
    c.execute("UPDATE task SET status='confirmed' WHERE id=?", (task_id,))
    con.commit()
    print(f"  ✅ 确认 → 状态 confirmed，@{assignee} 已被指派，进入看板")

    # 提醒（模拟到期扫描）
    if deadline and ("周五" in deadline or "明天" in deadline or "天内" in deadline):
        print(f"  ⏰ 提醒调度：距截止<24h → 推送@负责人 提醒档位=due")
    c.execute("INSERT INTO audit(actor,action,detail,ts) VALUES('ai','confirm',?,datetime('now'))",
              (json.dumps({"task": task_id, "assignee": assignee}, ensure_ascii=False),))
    con.commit()
    return task_id


def show_board(con):
    print("\n" + "=" * 56)
    print("📊 看板（任务列表）")
    c = con.cursor()
    c.execute("SELECT id, content, assignee, deadline, status FROM task")
    for r in c.fetchall():
        print(f"  #{r[0]}  [{r[4]}] {r[1][:26]} → 负责人:{r[2]} 截止:{r[3]}")


if __name__ == "__main__":
    print("🚀 对话式 AI 办公 · MVP 最小闭环 demo")
    print(f"   LLM={LLM_MODEL}  DB=sqlite:{DB_FILE}\n")
    con = init_db()
    # 3 条典型消息：明确指派(有歧义) / 主动认领 / 非任务
    messages = [
        "小张 你来跟进一下这个方案，周五前给我",        # assigned，但有两个小张 → 消歧
        "这次618复盘我来负责，下周一出报告",             # self 认领
        "今天的天气怎么样",                             # 非任务
    ]
    for m in messages:
        run_message(con, m)
        time.sleep(0.5)
    show_board(con)
    print("\n✅ 最小闭环跑通：消息→意图→归属消歧→任务→确认→看板→提醒")
