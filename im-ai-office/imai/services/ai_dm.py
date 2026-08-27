#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 助手私聊会话服务（自 core.py:504-637 1:1 迁移）

DM 收发/未读闭环 + 歧义回复收敛（resolve_assignee_reply/resolve_task_by_choice）。
【现状缺陷登记】单聊回调检查 action=='assigned' 而本模块实际返回 'confirmed'，
告知分支不可达；由 tests/guard g2_5 docstring 锁定记录。
"""
import json

from imai.config import EVENTS
from imai.repos import (get_task_dict, latest_pending_assignee_by_dm_taskid,
                        latest_pending_assignee_for_creator)
from imai.services.tasks import confirm_task, reject_task


def get_pending_assignee_task(con, sender):
    """取该发送者最近一条 pending_assignee 任务。"""
    return latest_pending_assignee_for_creator(con, sender)


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
        task = get_task_dict(con, task_id)
    else:
        # 从 ai_dm 里查该用户最近一条带 task_id 的消息
        task = latest_pending_assignee_by_dm_taskid(con, sender)
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
