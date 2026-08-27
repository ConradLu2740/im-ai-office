#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""杂项路由（自旧 app.py 1:1 迁移）：审计 / 每日汇总 / AI 助手私聊"""
from typing import Optional

from fastapi import APIRouter

from imai.config import EVENTS
from imai.db import get_conn
from imai.repos import audit_recent
from imai.services.ai_dm import ai_dm_list, ai_dm_mark_read, ai_dm_unread_count

router = APIRouter()


@router.get("/api/ai_dm")
def ai_dm(sender_id: Optional[str] = None):
    con = get_conn()
    msgs = ai_dm_list(con, sender_id)
    unread = ai_dm_unread_count(con, sender_id)
    con.close()
    return {"messages": msgs, "unread": unread}


@router.post("/api/ai_dm/read")
def ai_dm_read(body: dict):
    con = get_conn()
    ai_dm_mark_read(con, body.get("sender_id"))
    con.close()
    return {"ok": True}


@router.get("/api/audit")
def audit_list(limit: int = 30):
    con = get_conn()
    try:
        return {"ok": True, "audit": audit_recent(con, limit)}
    finally:
        con.close()


@router.get("/api/summary/daily")
def summary_daily(group_id: Optional[str] = None):
    """M2 每日汇总兜底：当天未确认归属任务清单（下班前推给群主/管理员）。"""
    from imai.repos import audit_log
    from imai.services.memory import build_daily_summary
    con = get_conn()
    try:
        sm = build_daily_summary(con, group_id)
        # 审计：汇总动作留痕
        audit_log(con, "system", "daily_summary", sm)
        return {"ok": True, **sm}
    finally:
        con.close()
