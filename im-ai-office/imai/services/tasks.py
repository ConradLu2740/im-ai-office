#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""任务状态流转服务（自 core.py:443-503 1:1 迁移）：confirm/reject/list/update"""
import json
from datetime import datetime

from imai.config import EVENTS
from imai.repos import audit_log

CANCELLED = "cancelled"


def list_tasks(con, status=None):
    from imai.repos import list_task_dicts
    return list_task_dicts(con, status)


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


def complete_task(con, task_id, actor="user"):
    """G1 完成回流（工作流缺口登记与完成回流Spec §1）：confirmed/pending → done。

    done 是新增终态：提醒扫描白名单不含 done → 逾期提醒自然终止。"""
    c = con.cursor()
    c.execute("SELECT status FROM task WHERE id=?", (task_id,))
    row = c.fetchone()
    if not row:
        return False
    if (row["status"] or "") not in ("confirmed", "pending_confirmation", "pending_assignee"):
        return False
    c.execute("UPDATE task SET status='done', updated_at=datetime('now') WHERE id=?", (task_id,))
    con.commit()
    audit_log(con, actor, "task_completed", {"taskId": task_id})
    EVENTS.append({"event": "task.completed", "taskId": task_id})
    return True


def update_task(con, task_id, assignee=None, deadline=None, cancel=False):
    """迭代2 B1：已确认任务修改（改负责人/改期/取消）。

    返回 (row, err)；err ∈ task_not_found / bad_deadline / no_changes / None。
    deadline 变更时清空该任务 reminder_sent（三档提醒按新时间重新起算，Spec §1.2）。
    每处变更写 audit(action='task_update', detail={field, old, new})。
    """
    c = con.cursor()
    c.execute("SELECT * FROM task WHERE id=?", (task_id,))
    row = c.fetchone()
    if not row:
        return None, "task_not_found"
    changes = {}
    if assignee is not None and assignee != row["assignee"]:
        c.execute("UPDATE task SET assignee=?, updated_at=datetime('now') WHERE id=?",
                  (assignee, task_id))
        changes["assignee"] = (row["assignee"], assignee)
    if deadline is not None:
        try:
            dt = datetime.strptime(deadline, "%Y-%m-%d %H:%M")
        except ValueError:
            return None, "bad_deadline"
        c.execute("UPDATE task SET deadline=?, deadline_at=?, updated_at=datetime('now') WHERE id=?",
                  (deadline, dt.strftime("%Y-%m-%d %H:%M"), task_id))
        changes["deadline"] = (row["deadline"], deadline)
        c.execute("DELETE FROM reminder_sent WHERE task_id=?", (task_id,))
    if cancel:
        c.execute("UPDATE task SET status=?, updated_at=datetime('now') WHERE id=?",
                  (CANCELLED, task_id))
        changes["status"] = (row["status"], CANCELLED)
    con.commit()
    if not changes:
        return None, "no_changes"
    for field, (old, new) in changes.items():
        audit_log(con, "user", "task_update",
                  {"taskId": task_id, "field": field, "old": old, "new": new})
        if field == "deadline":
            audit_log(con, "user", "reminder_reset", {"taskId": task_id})
    c.execute("SELECT * FROM task WHERE id=?", (task_id,))
    return c.fetchone(), None


def reject_task(con, task_id, reason="", assignee=None):
    c = con.cursor()
    c.execute("UPDATE task SET status='rejected', updated_at=datetime('now') WHERE id=?", (task_id,))
    con.commit()
    audit_log(con, "user", "reject", {"taskId": task_id, "reason": reason})
    # S4/M4: 修正信号沉淀 —— 若驳回理由指明正确负责人，更新人称别名
    from imai.services.memory import _memorize_reject_signal
    _memorize_reject_signal(con, reason, task_id)
    return True
