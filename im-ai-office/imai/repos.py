#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数据访问层：集中高频/复用查询（SQL 语义与 core.py 1:1）

约定：
- 只放被多模块复用或结构复杂的查询；简单单行写允许留在服务层原样直写
- 全部函数接收 con（连接由调用方管理），不自行开关连接
"""
from imai.db import _rows, take_id


# ============ 人 / 别名 ============

def find_persons_by_alias(con, name):
    """别名 → 候选人列表 [dict(id, real_name, flower_name)]（双方言统一 dict 行）"""
    c = con.cursor()
    c.execute("SELECT p.id, p.real_name, p.flower_name FROM alias a JOIN person p ON p.id=a.person_id WHERE a.name=?", (name,))
    return _rows(c)


def distinct_alias_names(con):
    c = con.cursor()
    c.execute("SELECT DISTINCT name FROM alias")
    return [r["name"] for r in _rows(c)]


def alias_label_rows(con):
    """DISTINCT 别名-正名-花名（注入与溯源共用），dict 行。"""
    c = con.cursor()
    c.execute("SELECT DISTINCT a.name, p.real_name, p.flower_name FROM alias a JOIN person p ON p.id=a.person_id")
    return _rows(c)


def insert_alias_if_absent(con, person_id, name) -> bool:
    """幂等插入别名；返回是否实际新增。"""
    c = con.cursor()
    c.execute("SELECT 1 FROM alias WHERE person_id=? AND name=?", (person_id, name))
    if not c.fetchone():
        c.execute("INSERT INTO alias(person_id, name) VALUES(?,?)", (person_id, name))
        con.commit()
        return True
    return False


# ============ 任务 ============

def insert_task(con, content, creator, assignee, deadline, status, confidence,
                source_msg, pending_meta=None):
    """插入任务，返回自增 id。pending_meta 由调用方保证 JSON 字符串。"""
    if pending_meta is not None:
        c = con.cursor()
        c.execute(
            "INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg,pending_meta)"
            " VALUES(?,?,?,?,?,?,?,?) RETURNING id",
            (content, creator, assignee, deadline, status, confidence, source_msg, pending_meta))
    else:
        c = con.cursor()
        c.execute(
            "INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg)"
            " VALUES(?,?,?,?,?,?,?) RETURNING id",
            (content, creator, assignee, deadline, status, confidence, source_msg))
    tid = take_id(c)
    con.commit()
    return tid


def get_task_dict(con, task_id):
    c = con.cursor()
    c.execute("SELECT * FROM task WHERE id=?", (task_id,))
    row = c.fetchone()
    return dict(row) if row else None


def list_task_dicts(con, status=None):
    """默认排除 cancelled（迭代2 B1 终态，看板不展示）；status 参数优先。"""
    c = con.cursor()
    if status:
        c.execute("SELECT * FROM task WHERE status=? ORDER BY id DESC", (status,))
    else:
        c.execute("SELECT * FROM task WHERE status != 'cancelled' ORDER BY id DESC")
    return _rows(c)


def latest_pending_assignee_for_creator(con, creator):
    """取该发送者最近一条 pending_assignee 任务。"""
    c = con.cursor()
    c.execute("SELECT * FROM task WHERE creator=? AND status='pending_assignee' ORDER BY id DESC LIMIT 1", (creator,))
    row = c.fetchone()
    return dict(row) if row else None


def latest_pending_assignee_by_dm_taskid(con, sender_id):
    """从 ai_dm 最近带 task_id 的记录回查 pending_assignee 任务。"""
    task = None
    c = con.cursor()
    c.execute("SELECT * FROM ai_dm WHERE sender_id=? AND task_id IS NOT NULL ORDER BY id DESC LIMIT 1", (sender_id,))
    row = c.fetchone()
    if row:
        tid = row["task_id"]
        c.execute("SELECT * FROM task WHERE id=? AND status='pending_assignee' ORDER BY id DESC LIMIT 1", (tid,))
        t2 = c.fetchone()
        task = dict(t2) if t2 else None
    return task


# ============ 消息表（本地 message）============

def message_add(con, conv_id, sender_id, sender_name, content, is_self=0,
                msg_seq=None, client_msg_id=None, content_type=101):
    """记录一条消息（自己发或收到的）。返回自增 id。
    幂等：同 conv 内相同 client_msg_id 已存在时直接返回既有 id，
    防 SDK 重连重投递导致重复入库/重复 AI（2026-08-30 实证）。"""
    c = con.cursor()
    if client_msg_id:
        c.execute("SELECT id FROM message WHERE conv_id=? AND client_msg_id=? LIMIT 1",
                  (conv_id, client_msg_id))
        row = c.fetchone()
        if row:
            con.commit()
            return row[0]
    c.execute(
        "INSERT INTO message(conv_id, sender_id, sender_name, content, is_self, msg_seq, client_msg_id, content_type) VALUES(?,?,?,?,?,?,?,?) RETURNING id",
        (conv_id, sender_id, sender_name, content, is_self, msg_seq, client_msg_id, content_type))
    mid = take_id(c)
    con.commit()
    return mid


def message_list(con, conv_id=None):
    """取某会话的消息历史，按 id 升序。"""
    c = con.cursor()
    if conv_id:
        c.execute("SELECT * FROM message WHERE conv_id=? ORDER BY id ASC", (conv_id,))
    else:
        c.execute("SELECT * FROM message ORDER BY id ASC")
    return _rows(c)


# ============ 审计 ============

def audit_log(con, actor, action, detail=None):
    """审计：所有关键 AI/人工动作留痕。actor: ai | user:<id> | system。detail 序列化为 JSON 字符串。"""
    import json
    c = con.cursor()
    c.execute("INSERT INTO audit(actor,action,detail) VALUES(?,?,?)",
              (actor, action, json.dumps(detail, ensure_ascii=False) if detail is not None else None))
    con.commit()


def audit_recent(con, limit=30):
    c = con.cursor()
    # PG 无 rowid：用自增 id；SQLite 保留 rowid。
    # 时间列运行时探测（交接文档 #11）：代码 schema=ts，生产旧库=created_at（先例 stats._audit_time_col）
    from imai.db import BACKEND
    if BACKEND == "postgres":
        c.execute("SELECT column_name AS col FROM information_schema.columns "
                  "WHERE table_name='audit' AND column_name IN ('ts','created_at')")
        names = {r["col"] for r in c.fetchall()}
        tcol = "ts" if "ts" in names else ("created_at" if "created_at" in names else None)
        if not tcol:
            raise RuntimeError("audit 表缺少时间列（ts/created_at）")
        c.execute(f"SELECT actor,action,detail,{tcol} AS ts FROM audit ORDER BY id DESC LIMIT %s", (limit,))
    else:
        c.execute("SELECT actor,action,detail,ts FROM audit ORDER BY rowid DESC LIMIT ?", (limit,))
    return _rows(c)


# ============ 术语 / 团队记忆 ============

def list_term_dicts(con):
    c = con.cursor()
    c.execute("SELECT * FROM term ORDER BY id DESC")
    return _rows(c)
