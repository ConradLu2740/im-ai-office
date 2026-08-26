#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对话式 AI 办公 · MVP 核心逻辑（可复用模块）

本地单机可运行版：SQLite 存储 + 进程内事件队列 + Proma Cloud 真实 LLM。
供 FastAPI 服务(app.py) 复用，也可 standalone 跑。
只依赖标准库 + Proma Cloud LLM。
"""
import json
import os
import sqlite3
import urllib.request
from datetime import datetime

# ============ 配置（本地单机可覆盖）============
# 默认值指向 DeepSeek 官方 API；真实 key 请通过环境变量或 .env 注入
LLM_BASE = os.environ.get("LLM_BASE", "https://api.deepseek.com/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")
DB_FILE = os.environ.get("IMAI_DB", os.path.join(os.path.dirname(__file__) or ".", "imai.db"))

# 进程内事件队列（模拟 Redis Streams；真实环境用 Redis）
EVENTS = []


# ============ 数据层（SQLite）============
def init_db(db_file=None):
    con = sqlite3.connect(db_file or DB_FILE)
    c = con.cursor()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS person(id INTEGER PRIMARY KEY, real_name TEXT, flower_name TEXT, title TEXT, group_id INTEGER);
    CREATE TABLE IF NOT EXISTS alias(person_id INTEGER, name TEXT);
    CREATE TABLE IF NOT EXISTS task(id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, creator TEXT,
                      assignee TEXT, deadline TEXT, status TEXT, confidence TEXT, source_msg TEXT,
                      pending_meta TEXT,
                      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);
    CREATE TABLE IF NOT EXISTS audit(actor TEXT, action TEXT, detail TEXT, ts TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS ai_dm(id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id TEXT, direction TEXT, content TEXT, task_id INTEGER, read_flag INTEGER DEFAULT 0, ts TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS message(id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT, sender_id TEXT, sender_name TEXT, content TEXT, content_type INTEGER DEFAULT 101, is_self INTEGER DEFAULT 0, msg_seq INTEGER, client_msg_id TEXT, ts TEXT DEFAULT (datetime('now')));
    -- M3 RBAC: 角色表
    CREATE TABLE IF NOT EXISTS role(oim_user_id TEXT PRIMARY KEY, role TEXT DEFAULT 'member', updated_at TEXT DEFAULT (datetime('now')));
    -- M3 RBAC: 高风险动作审批表
    CREATE TABLE IF NOT EXISTS approval(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, detail TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), decided_at TEXT, decided_by TEXT);
    -- M4 团队记忆: 术语表
    CREATE TABLE IF NOT EXISTS term(id INTEGER PRIMARY KEY AUTOINCREMENT, term TEXT NOT NULL UNIQUE, meaning TEXT NOT NULL, source TEXT DEFAULT 'manual', created_at TEXT DEFAULT (datetime('now')));
    -- M4 团队记忆: 群简介/旁听开关
    CREATE TABLE IF NOT EXISTS grp_meta(oim_group_id TEXT PRIMARY KEY, intro TEXT DEFAULT '', ai_enabled INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now')));
    """)
    # 种子人 + 别名（制造「两个小张」消歧场景），仅当为空
    c.execute("SELECT COUNT(*) FROM person")
    if c.fetchone()[0] == 0:
        c.executemany("INSERT INTO person VALUES(?,?,?,?,?)", [
            (1, "张伟", "小张", "产品经理", 100),
            (2, "张敏", "小张", "市场专员", 100),
            (3, "李娜", "娜姐", "运营", 100),
        ])
        c.executemany("INSERT INTO alias VALUES(?,?)", [(1, "小张"), (1, "张伟"), (2, "小张"), (2, "张敏"), (3, "娜姐")])
    con.row_factory = sqlite3.Row  # 统一 Row 访问，dict(row) 可用
    con.commit()
    return con


def get_conn(db_file=None):
    con = sqlite3.connect(db_file or DB_FILE)
    con.row_factory = sqlite3.Row
    return con


# ============ M3 RBAC 授权（角色判定 + 高风险审批 + 审计）============

# 高风险动作：AI 不能直接执行，须人工批准
HIGH_RISK_ACTIONS = {"assign_notify", "dm_send", "delete_task", "broadcast"}


def audit(con, actor, action, detail=None):
    """审计：所有关键 AI/人工动作留痕。actor: ai | user:<id> | system。"""
    c = con.cursor()
    c.execute("INSERT INTO audit(actor,action,detail) VALUES(?,?,?)",
              (actor, action, json.dumps(detail, ensure_ascii=False) if detail is not None else None))
    con.commit()


def get_role(con, oim_user_id):
    """返回用户角色，查不到默认 member；imAdmin 视为 group_admin。"""
    c = con.cursor()
    if oim_user_id == "imAdmin":
        return "group_admin"
    c.execute("SELECT role FROM role WHERE oim_user_id=?", (oim_user_id,))
    row = c.fetchone()
    return row[0] if row else "member"


def set_role(con, oim_user_id, role):
    """设置/更新用户角色。"""
    valid = {"member", "group_admin"}
    if role not in valid:
        raise ValueError(f"invalid role: {role}")
    c = con.cursor()
    c.execute("INSERT INTO role(oim_user_id, role) VALUES(?,?) "
              "ON CONFLICT(oim_user_id) DO UPDATE SET role=excluded.role, updated_at=datetime('now')",
              (oim_user_id, role))
    con.commit()
    audit(con, "system", "set_role", {"oim_user_id": oim_user_id, "role": role})


def can_do(con, oim_user_id, action, role=None):
    """返回 (允许, 说明)。action ∈ read_group/write_board/...及高风险项。
    AI 角色 ai-group-assistant: 读群必须、写看板记审计、高风险 require_approval。"""
    role = role or get_role(con, oim_user_id)
    if action in HIGH_RISK_ACTIONS:
        if role == "group_admin":
            return True, "admin 允许，直接执行"
        return False, "require_approval"   # 高风险：一律先人工批准
    if action == "read_group":
        return True, "读群允许"
    if action == "write_board":
        return True, "写看板允许"
    return True, "default allow"


def require_approval(con, actor, action, detail=None):
    """插入一条待审批准。返回 approval id。AI 不直接执行高风险动作，只落审批。"""
    c = con.cursor()
    c.execute("INSERT INTO approval(actor,action,detail,status) VALUES(?,?,?,'pending')",
              (actor, action, json.dumps(detail, ensure_ascii=False) if detail is not None else None))
    con.commit()
    _id = c.lastrowid
    audit(con, actor, "approval_pending", {"approvalId": _id, "action": action, "detail": detail})
    return _id


def list_approvals(con, status="pending"):
    """列出待审批/已处理审批。"""
    c = con.cursor()
    if status:
        c.execute("SELECT * FROM approval WHERE status=? ORDER BY id DESC", (status,))
    else:
        c.execute("SELECT * FROM approval ORDER BY id DESC")
    cols = [d[0] for d in c.description]
    return [dict(zip(cols, r)) for r in c.fetchall()]


def decide_approval(con, approval_id, approved, decided_by):
    """人工批复：批准则返回 detail(dict) 供后续执行；拒绝则标记 rejected。"""
    status = "approved" if approved else "rejected"
    c = con.cursor()
    c.execute("UPDATE approval SET status=?, decided_at=datetime('now'), decided_by=? WHERE id=?",
              (status, decided_by, approval_id))
    con.commit()
    audit(con, f"user:{decided_by}", "approval_approved" if approved else "approval_rejected",
          {"approvalId": approval_id})
    c.execute("SELECT * FROM approval WHERE id=?", (approval_id,))
    row = c.fetchone()
    if not row:
        return None, None
    cols = [d[0] for d in c.description]
    r = dict(zip(cols, row))
    detail = json.loads(r["detail"]) if r.get("detail") else None
    return r, detail


# ============ M4 团队记忆（术语表 + 群简介 + 注入 + 修正信号沉淀）============

def list_terms(con):
    c = con.cursor()
    c.execute("SELECT * FROM term ORDER BY id DESC")
    return [dict(r) for r in c.fetchall()]


def add_term(con, term, meaning, source="manual"):
    """新增术语；若已存在则覆盖 meaning。带审计。"""
    c = con.cursor()
    c.execute("INSERT INTO term(term, meaning, source) VALUES(?,?,?) "
              "ON CONFLICT(term) DO UPDATE SET meaning=excluded.meaning, source=excluded.source",
              (term, meaning, source))
    con.commit()
    audit(con, "system", "memorize", {"type": "term", "term": term, "meaning": meaning, "source": source})


def get_grp_meta(con, oim_group_id):
    c = con.cursor()
    c.execute("SELECT * FROM grp_meta WHERE oim_group_id=?", (oim_group_id,))
    row = c.fetchone()
    if not row:
        return {"oim_group_id": oim_group_id, "intro": "", "ai_enabled": 1}
    cols = [d[0] for d in c.description]
    return dict(zip(cols, row))


def set_grp_meta(con, oim_group_id, intro=None, ai_enabled=None):
    c = con.cursor()
    cur = get_grp_meta(con, oim_group_id)
    new_intro = intro if intro is not None else cur.get("intro", "")
    new_enabled = ai_enabled if ai_enabled is not None else cur.get("ai_enabled", 1)
    c.execute("INSERT INTO grp_meta(oim_group_id, intro, ai_enabled) VALUES(?,?,?) "
              "ON CONFLICT(oim_group_id) DO UPDATE SET intro=excluded.intro, ai_enabled=excluded.ai_enabled, "
              "updated_at=datetime('now')", (oim_group_id, new_intro, new_enabled))
    con.commit()
    audit(con, "system", "set_grp_meta", {"group_id": oim_group_id, "intro": new_intro, "ai_enabled": new_enabled})


def memorize_corrective(con, sender, correction_type, payload):
    """修正信号沉淀：correction_type ∈ person/term/deadline。
    - person: 更新 alias（把称呼绑定到正确 person）
    - term: 新增/覆盖 term
    - deadline: 只更新任务，不沉淀为长期记忆
    """
    if correction_type == "term":
        add_term(con, payload.get("term", ""), payload.get("meaning", ""), source="corrected")
    elif correction_type == "person":
        name = payload.get("name", "")
        person_id = payload.get("person_id")
        if name and person_id:
            c = con.cursor()
            # 幂等：该 person 下已有同名 alias 则不重复
            c.execute("SELECT 1 FROM alias WHERE person_id=? AND name=?", (person_id, name))
            if not c.fetchone():
                c.execute("INSERT INTO alias(person_id, name) VALUES(?,?)", (person_id, name))
                con.commit()
                audit(con, f"user:{sender}", "memorize", {"type": "person", "name": name, "person_id": person_id})
    else:
        # deadline 等：只记审计，不作长期记忆
        audit(con, f"user:{sender}", "memorize", {"type": correction_type, "payload": payload})


def build_sys_ctx(con, group_id):
    """拼群简介 + 术语 + 人称 作为 system 上下文注入。"""
    ctx = []
    gm = get_grp_meta(con, group_id)
    if gm.get("intro"):
        ctx.append(f"【群简介】{gm['intro']}")
    terms = list_terms(con)
    if terms:
        ctx.append("【术语】" + "；".join(f"{t['term']}={t['meaning']}" for t in terms))
    # 人称/别名
    c = con.cursor()
    c.execute("SELECT DISTINCT a.name, p.real_name, p.flower_name FROM alias a JOIN person p ON p.id=a.person_id")
    names = []
    for r in c.fetchall():
        label = r[1] or r[2] or ""
        if r[0] and label and r[0] != label:
            names.append(f"{r[0]}={label}")
    if names:
        ctx.append("【人称】" + "；".join(sorted(set(names))))
    return "\n".join(ctx)


# ============ M2 每日汇总兜底 ============

# 每日汇总要覆盖的“未定归属”状态
UNRESOLVED_STATUS = ("pending_assignee", "pending_confirmation")


def list_daily_unconfirmed(con, group_id=None, date=None):
    """列出仍未定归属的任务（pending_assignee / pending_confirmation）。
    date: 可选，'YYYY-MM-DD'；不传则统计当前所有未定归属（含昨日遗留）。
    产品本意“当天未确认→下班前汇总”，即截止到汇总时刻仍未确认的都该兜底。"""
    c = con.cursor()
    if date:
        sql = ("SELECT * FROM task WHERE status IN (?,?) AND date(created_at) = ? "
               "ORDER BY id DESC")
        params = list(UNRESOLVED_STATUS) + [date]
    else:
        sql = "SELECT * FROM task WHERE status IN (?,?) ORDER BY id DESC"
        params = list(UNRESOLVED_STATUS)
    c.execute(sql, params)
    cols = [d[0] for d in c.description]
    return [dict(zip(cols, r)) for r in c.fetchall()]


def build_daily_summary(con, group_id=None, date=None):
    """生成每日待确认汇总文本（兜底：下班前推给群主/管理员）。"""
    tasks = list_daily_unconfirmed(con, group_id, date)
    if not tasks:
        return {"date": date or datetime.now().strftime("%Y-%m-%d"), "count": 0,
                "text": "今日暂无待确认任务 🎉"}
    lines = ["【IMAI 每日汇总】今天还有以下任务未确认归属："]
    for i, t in enumerate(tasks, 1):
        deadline = t.get("deadline") or "未定"
        assignee = t.get("assignee") or "待指派"
        # 若 pending_assignee 且带候选，标注候选
        hit = f"#{t['id']} {t['content']}（发起：{t['creator']}，负责人：{assignee}，截止：{deadline}）"
        lines.append(f"{i}. {hit}")
    lines.append("请群主/管理员及时确认或指派，避免遗漏。")
    return {"date": date or datetime.now().strftime("%Y-%m-%d"),
            "count": len(tasks), "text": "\n".join(lines)}


def memory_proofs(con, text):
    """溯源：扫描文本命中哪些团队记忆（术语/人称），返回依据列表。
    [{type, term, meaning, source}] —— 供确认卡/任务卡片标注「依据：术语 X」"""
    if not text:
        return []
    proofs = []
    for t in list_terms(con):
        if t["term"] and t["term"] in text:
            proofs.append({"type": "term", "term": t["term"], "meaning": t["meaning"], "source": t["source"]})
    c = con.cursor()
    c.execute("SELECT DISTINCT a.name, p.real_name, p.flower_name FROM alias a JOIN person p ON p.id=a.person_id")
    for r in c.fetchall():
        name, real, flower = r[0], r[1], r[2]
        # 只要 name 是别名/花名（不等于正名）且出现在文本，就作为依据
        if name and name in text and name != real:
            proofs.append({"type": "person", "term": name, "meaning": real or flower, "source": "alias"})
    return proofs


# ============ LLM（Proma Cloud · OpenAI 兼容）============
def llm_chat(system, user, json_mode=True):
    payload = {
        "model": LLM_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.2,
        "max_tokens": 1024,
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


def to_bool(v):
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() == "true"


# ============ 意图判定 ============
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
        intent = json.loads(raw)
        # 规范化 LLM 输出：is_task 偶发返回字符串 "true"/"false"，统一转布尔，避免下游 `is True` 断言/前端展示不稳定
        if isinstance(intent, dict):
            intent["is_task"] = to_bool(intent.get("is_task"))
        return intent
    except Exception:
        return {"is_task": False, "confidence": "low"}


# ============ 归属判定（别名消歧 + 认领模式）============
def find_by_alias(con, name):
    c = con.cursor()
    c.execute("SELECT p.id, p.real_name, p.flower_name FROM alias a JOIN person p ON p.id=a.person_id WHERE a.name=?", (name,))
    return c.fetchall()


def resolve(con, msg, sender="李娜(娜姐)", intent=None):
    mode = (intent or {}).get("assign_mode", "none")
    if mode == "self":
        return {"assignee": sender, "confidence": "high", "candidates": [], "mode": mode, "ambiguous": False}
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
        return {"assignee": hint or None, "confidence": "low", "candidates": [], "mode": mode, "ambiguous": False}
    if len(uniq) == 1:
        return {"assignee": uniq[0][1] + "/" + (uniq[0][2] or ""), "confidence": "high", "candidates": uniq, "mode": mode, "ambiguous": False}
    labels = [{"person_id": r[0], "label": f"{r[1]}({r[2]})"} for r in uniq]
    return {"assignee": None, "confidence": "medium", "candidates": uniq, "mode": mode, "ambiguous": True,
            "ambiguous_labels": labels}


# ============ 主流程 ============
def process_message(msg, sender="李娜(娜姐)", group_id=None):
    """跑完整链路，返回结构化结果。group_id 用于群级上下文注入。"""
    con = init_db()
    sys_ctx = build_sys_ctx(con, group_id) if group_id else ""
    intent = intent_detect(msg, sys_ctx=sys_ctx)
    base = {"message": msg, "sender": sender, "intent": intent}
    if not to_bool(intent.get("is_task")):
        base["action"] = "skip"  # 非任务，静默
        return base

    assign = resolve(con, msg, sender, intent)
    base["assign"] = assign

    if assign.get("ambiguous"):
        # 有歧义 -> 先落库 pending_assignee，再由 app.py 私聊发送者确认
        content = intent.get("content") or msg
        deadline = intent.get("deadline_hint")
        c = con.cursor()
        pending_meta = json.dumps({"candidates": assign.get("ambiguous_labels", [])}, ensure_ascii=False)
        c.execute(
            "INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg,pending_meta) VALUES(?,?,?,?,?,?,?,?)",
            (content, sender, None, deadline, "pending_assignee", intent.get("confidence"), msg, pending_meta))
        con.commit()
        task_id = c.lastrowid
        audit(con, "ai", "identify_ambiguous", {"taskId": task_id, "content": content, "candidates": assign.get("ambiguous_labels", [])})
        base["action"] = "confirm_assignee"
        base["needs_confirmation"] = True
        base["task"] = {"taskId": task_id, "content": content, "assignee": None,
                        "deadline": deadline, "status": "pending_assignee",
                        "candidates": assign.get("ambiguous_labels", [])}
        return base

    assignee = assign.get("assignee") or "待指派"
    content = intent.get("content") or msg
    deadline = intent.get("deadline_hint")

    c = con.cursor()
    c.execute(
        "INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg) VALUES(?,?,?,?,?,?,?)",
        (content, sender, assignee, deadline, "pending_confirmation", intent.get("confidence"), msg))
    con.commit()
    task_id = c.lastrowid
    audit(con, "ai", "task_created", {"taskId": task_id, "content": content, "assignee": assignee, "deadline": deadline})
    # 入事件队列
    EVENTS.append({"event": "task.created", "taskId": task_id, "assignee": assignee, "deadline": deadline})
    base["action"] = "task_created"
    base["task"] = {"taskId": task_id, "content": content, "assignee": assignee,
                    "deadline": deadline, "status": "pending_confirmation"}
    return base


def confirm_task(con, task_id, assignee=None, deadline=None):
    c = con.cursor()
    if assignee:
        c.execute("UPDATE task SET status='confirmed', assignee=?, updated_at=datetime('now') WHERE id=?",
                  (assignee, task_id))
    else:
        c.execute("UPDATE task SET status='confirmed', updated_at=datetime('now') WHERE id=?", (task_id,))
    con.commit()
    c.execute("SELECT * FROM task WHERE id=?", (task_id,))
    row = c.fetchone()
    if row:
        # 到期提醒（简化：临近截止提醒）
        if row["deadline"] and ("周五" in row["deadline"] or "明天" in row["deadline"] or "天内" in row["deadline"]):
            EVENTS.append({"event": "reminder.due", "taskId": task_id, "assignee": row["assignee"], "tier": "due"})
    c.execute("INSERT INTO audit(actor,action,detail) VALUES('user','confirm',?)",
              (json.dumps({"taskId": task_id}, ensure_ascii=False),))
    con.commit()
    return True


def reject_task(con, task_id, reason="", assignee=None):
    c = con.cursor()
    c.execute("UPDATE task SET status='rejected', updated_at=datetime('now') WHERE id=?", (task_id,))
    con.commit()
    audit(con, "user", "reject", {"taskId": task_id, "reason": reason})
    # S4/M4: 修正信号沉淀 —— 若驳回理由指明正确负责人，更新人称别名
    _memorize_reject_signal(con, reason, task_id)
    return True


def _memorize_reject_signal(con, reason, task_id):
    """从驳回理由提取修正信号并沉淀。
    示例 reason: '负责人错了，应该是张敏' → 新增/确认人称映射。
    若正确人名不在 person 表，则以术语笔记形式沉淀（待补 person）。
    """
    if not reason:
        return
    import re
    m = re.search(r"(?:应该是|是|改为|正确.?(?:负责人|人)?.?:?\s*)([\u4e00-\u9fa5]{2,4})", reason)
    if not m:
        return
    correct_name = m.group(1)
    rows = find_by_alias(con, correct_name)
    if rows:
        return  # 已有人称映射，无需重复
    # 正确人名不在别名/人表 -> 记一条术语级修正信号（待后续补 person）
    memorize_corrective(con, "user", "term", {
        "term": f"人称:{correct_name}",
        "meaning": f"正确负责人人称（待绑定 person，来源 reject 任务#{task_id}）",
    })


def list_tasks(con, status=None):
    c = con.cursor()
    if status:
        c.execute("SELECT * FROM task WHERE status=? ORDER BY id DESC", (status,))
    else:
        c.execute("SELECT * FROM task ORDER BY id DESC")
    return [dict(r) for r in c.fetchall()]


def get_pending_assignee_task(con, sender):
    """取该发送者最近一条 pending_assignee 任务。"""
    c = con.cursor()
    c.execute("SELECT * FROM task WHERE creator=? AND status='pending_assignee' ORDER BY id DESC LIMIT 1", (sender,))
    row = c.fetchone()
    return dict(row) if row else None


def resolve_assignee_reply(con, sender, reply):
    """处理发送者对归属歧义的私聊回复。
    回复：1/2/3... 选择候选人；'确认' 确认当前负责人；'取消' 驳回。
    """
    c = con.cursor()
    task = get_pending_assignee_task(con, sender)
    if not task:
        return {"ok": False, "reason": "no_pending_task"}

    meta = json.loads(task["pending_meta"] or "{}")
    candidates = meta.get("candidates", [])
    reply_norm = reply.strip()

    # 取消
    if reply_norm in ("取消", "否", "不对", "错误"):
        reject_task(con, task["id"], reason="发送者取消歧义确认")
        return {"ok": True, "action": "rejected", "taskId": task["id"]}

    # 数字选择：发送者确认负责人后，任务直接变为 confirmed（低打扰，不再二次确认）
    if reply_norm.isdigit():
        idx = int(reply_norm) - 1
        if 0 <= idx < len(candidates):
            chosen = candidates[idx]
            assignee = chosen["label"]
            c.execute("UPDATE task SET status='confirmed', assignee=?, pending_meta=NULL, updated_at=datetime('now') WHERE id=?",
                      (assignee, task["id"]))
            con.commit()
            EVENTS.append({"event": "task.confirmed", "taskId": task["id"], "assignee": assignee})
            return {"ok": True, "action": "confirmed", "taskId": task["id"], "assignee": assignee}
        else:
            return {"ok": False, "reason": "invalid_choice", "choices": [f"{i+1}. {c['label']}" for i, c in enumerate(candidates)]}

    # 确认：如果 task 已有 assignee（非歧义场景的通用确认）
    if reply_norm in ("确认", "是的", "对", "ok", "OK"):
        if task.get("assignee"):
            confirm_task(con, task["id"])
            return {"ok": True, "action": "confirmed", "taskId": task["id"]}
        else:
            return {"ok": False, "reason": "no_assignee_to_confirm"}

    return {"ok": False, "reason": "unknown_reply"}


# ============ AI 助手私聊会话（ai_dm）============

def ai_dm_send(con, sender_id, text, task_id=None, direction="out"):
    """记录一条 AI 助手会话消息。direction: out=AI发出 in=用户回复。"""
    c = con.cursor()
    c.execute("INSERT INTO ai_dm(sender_id, direction, content, task_id) VALUES(?,?,?,?)",
              (sender_id, direction, text, task_id))
    con.commit()
    return c.lastrowid


def ai_dm_list(con, sender_id=None):
    """取与某用户（或全部）的 AI 助手会话历史，按时间升序。"""
    c = con.cursor()
    if sender_id:
        c.execute("SELECT * FROM ai_dm WHERE sender_id=? ORDER BY id ASC", (sender_id,))
    else:
        c.execute("SELECT * FROM ai_dm ORDER BY id ASC")
    return [dict(r) for r in c.fetchall()]


def ai_dm_unread_count(con, sender_id=None):
    """AI 侧未读消息数（in 方向且未读）。"""
    c = con.cursor()
    if sender_id:
        c.execute("SELECT COUNT(*) FROM ai_dm WHERE sender_id=? AND direction='in' AND read_flag=0", (sender_id,))
    else:
        c.execute("SELECT COUNT(*) FROM ai_dm WHERE direction='in' AND read_flag=0")
    return c.fetchone()[0]


def ai_dm_mark_read(con, sender_id=None):
    """标记某用户的 AI 助手消息已读。"""
    c = con.cursor()
    if sender_id:
        c.execute("UPDATE ai_dm SET read_flag=1 WHERE sender_id=? AND direction='in'", (sender_id,))
    else:
        c.execute("UPDATE ai_dm SET read_flag=1 WHERE direction='in'")
    con.commit()


def resolve_task_by_choice(con, sender, choice, task_id=None):
    """按用户数字回复确认负责人。优先按 taskId，否则从 ai_dm 记录里查该用户最近任务。"""
    if task_id:
        c = con.cursor()
        c.execute("SELECT * FROM task WHERE id=?", (task_id,))
        row = c.fetchone()
        task = dict(row) if row else None
    else:
        # 从 ai_dm 里查该用户最近一条带 task_id 的消息
        task = None
        c = con.cursor()
        c.execute("SELECT * FROM ai_dm WHERE sender_id=? AND task_id IS NOT NULL ORDER BY id DESC LIMIT 1", (sender,))
        row = c.fetchone()
        if row:
            tid = row["task_id"]
            c.execute("SELECT * FROM task WHERE id=? AND status='pending_assignee' ORDER BY id DESC LIMIT 1", (tid,))
            t2 = c.fetchone()
            task = dict(t2) if t2 else None
        if not task:
            task = get_pending_assignee_task(con, sender)
    if not task:
        return {"ok": False, "error": "no_pending_task"}
    c = con.cursor()
    meta = json.loads(task["pending_meta"] or "{}")
    candidates = meta.get("candidates", [])
    choice_norm = choice.strip()
    if choice_norm.isdigit():
        idx = int(choice_norm) - 1
        if 0 <= idx < len(candidates):
            chosen = candidates[idx]
            assignee = chosen["label"]
            c.execute("UPDATE task SET status='confirmed', assignee=?, pending_meta=NULL, updated_at=datetime('now') WHERE id=?",
                      (assignee, task["id"]))
            con.commit()
            EVENTS.append({"event": "task.confirmed", "taskId": task["id"], "assignee": assignee})
            return {"ok": True, "action": "confirmed", "taskId": task["id"], "assignee": assignee}
        else:
            return {"ok": False, "error": "invalid_choice", "candidates": [f"{i+1}. {c['label']}" for i, c in enumerate(candidates)]}
    return {"ok": False, "error": "unknown_reply"}


# ============ 消息表（本地 message）============

def message_add(con, conv_id, sender_id, sender_name, content, is_self=0, msg_seq=None, client_msg_id=None, content_type=101):
    """记录一条消息（自己发或收到的）。"""
    c = con.cursor()
    c.execute(
        "INSERT INTO message(conv_id, sender_id, sender_name, content, is_self, msg_seq, client_msg_id, content_type) VALUES(?,?,?,?,?,?,?,?)",
        (conv_id, sender_id, sender_name, content, is_self, msg_seq, client_msg_id, content_type))
    con.commit()
    return c.lastrowid


def message_list(con, conv_id=None):
    """取某会话的消息历史，按 id 升序。"""
    c = con.cursor()
    if conv_id:
        c.execute("SELECT * FROM message WHERE conv_id=? ORDER BY id ASC", (conv_id,))
    else:
        c.execute("SELECT * FROM message ORDER BY id ASC")
    return [dict(r) for r in c.fetchall()]
