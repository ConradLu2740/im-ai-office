#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""每日汇总兜底推送（M2 收尾；Spec：每日汇总兜底Spec.md）

产品承诺（一页纸 M2）：发送者当天未确认 → 下班前自动把待确认清单推给群主/管理员。
此前仅有 /api/summary/daily 被动接口（生成不推送），本模块补齐闭环：

- 调度：scheduler 每轮调用 scan_and_push；本地时间 ≥ DIGEST_TIME（默认 18:00）
  且当日未推过 → 推送一次。digest_sent 按日期主键幂等，重启/重复扫描不重发。
- 收件人：role 表 role='admin'（RBAC 管理员）；为空时回落 DIGEST_FALLBACK_ADMIN。
- 通道：ai_dm（AI 助手会话，UI 可见）+ SSE fanout + audit 留痕，与到期提醒同型；
  不打群（防骚扰原则）。
- 时间语义：now 为本地 naive datetime（与 reminder.scan_once 同约定）。
"""
from datetime import datetime

from imai.config import DIGEST_TIME, DIGEST_FALLBACK_ADMIN
from imai.repos import audit_log
from imai.services.ai_dm import ai_dm_send
from imai.services import bus
from imai.services.memory import build_daily_summary


def _digest_admins(con):
    """RBAC 管理员收件人；role 表无 admin 时回落配置兜底人。"""
    c = con.cursor()
    try:
        c.execute("SELECT oim_user_id FROM role WHERE role='admin' ORDER BY oim_user_id")
        ids = [r[0] for r in c.fetchall()]
    except Exception:
        ids = []
    return [i for i in ids if i] or [DIGEST_FALLBACK_ADMIN]


def _already_pushed(con, date_str):
    c = con.cursor()
    c.execute("SELECT 1 FROM digest_sent WHERE digest_date=?", (date_str,))
    return c.fetchone() is not None


def scan_and_push(con, now=None):
    """每轮调度调用：到点且当日未推 → 生成汇总并推给管理员。

    返回 {"pushed": bool, "date": str, ...}；未推时附 reason（before_time/already_sent）。
    """
    now = now or datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    if _already_pushed(con, date_str):
        return {"pushed": False, "reason": "already_sent", "date": date_str}
    try:
        hh, mm = DIGEST_TIME.split(":")[:2]
        gate = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
    except (ValueError, IndexError):
        gate = now.replace(hour=18, minute=0, second=0, microsecond=0)
    if now < gate:
        return {"pushed": False, "reason": "before_time", "date": date_str}

    sm = build_daily_summary(con)
    targets = _digest_admins(con)
    for t in targets:
        ai_dm_send(con, t, sm["text"])
    c = con.cursor()
    c.execute("INSERT INTO digest_sent(digest_date, count) VALUES(?,?)", (date_str, sm["count"]))
    con.commit()
    audit_log(con, "scheduler", "daily_digest_pushed",
              {"date": date_str, "to": targets, "count": sm["count"]})
    bus.fanout("digest", {"date": date_str, "to": targets, "count": sm["count"]})
    return {"pushed": True, "date": date_str, "to": targets, "count": sm["count"]}
