#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""任务状态流转服务（自 core.py:443-503 1:1 迁移）：confirm/reject/list"""
import json

from imai.config import EVENTS
from imai.repos import audit_log


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


def reject_task(con, task_id, reason="", assignee=None):
    c = con.cursor()
    c.execute("UPDATE task SET status='rejected', updated_at=datetime('now') WHERE id=?", (task_id,))
    con.commit()
    audit_log(con, "user", "reject", {"taskId": task_id, "reason": reason})
    # S4/M4: 修正信号沉淀 —— 若驳回理由指明正确负责人，更新人称别名
    from imai.services.memory import _memorize_reject_signal
    _memorize_reject_signal(con, reason, task_id)
    return True
