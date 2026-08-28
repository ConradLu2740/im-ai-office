#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""到期提醒调度服务（迭代 1 补齐实现；Spec：提醒调度与缺陷修复Spec.md §1）

档位规则（产品思路 §12）：
- due_24h    : deadline_at − 24h ≤ now < deadline_at，confirmed 且有负责人
               → 提醒负责人（发起人 ai_dm 静默抄送）
- due_day    : now 当天 == deadline_at 当天，confirmed 且有负责人 → 提醒负责人
- overdue    : now > deadline_at，confirmed → 提醒负责人 + 发起人（逾期标记）
- unassigned : 未定归属（UNRESOLVED_STATUS：pending_assignee/pending_confirmation）
               且无负责人超过 24h → 只提醒发起人
               （Spec 原文只写 pending_confirmation；实际无负责人的未定任务两种状态都有，
                 与 config.UNRESOLVED_STATUS 的"未定归属"定义对齐）

去重：reminder_sent UNIQUE(task_id, tier)，每任务每档只发一次（先查后插，单线程调度够用）。
发送通道：ai_dm + SSE fanout + audit(action=reminder_sent)；OpenIM 群回写默认关（防骚扰）。

时间语义（重要）：
- deadline_at：解析器写入的本地时间（SQLite 存 TEXT；PG 存 TIMESTAMPTZ）
- created_at ：SQLite datetime('now') 是 UTC 文本；PG 是 TIMESTAMPTZ
  → 统一换算到本地 naive datetime 后比较，见 _as_local_dt / _created_local
"""
from datetime import datetime, timedelta, timezone

from imai.config import UNRESOLVED_STATUS
from imai.db import get_conn
from imai.repos import audit_log
from imai.services.ai_dm import ai_dm_send
from imai.services import bus
from imai.services.deadline_parser import backfill_pending


# ============ 时间归一化 ============

def _utc_to_local(dt):
    return dt.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)


def _as_local_dt(v):
    """deadline_at 值 → 本地 naive datetime。str 视为本地时间（解析器写入约定）。"""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.astimezone().replace(tzinfo=None) if v.tzinfo else v
    s = str(v).replace("T", " ")[:16]
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M")
    except ValueError:
        return None


def _created_local(v):
    """created_at 值 → 本地 naive datetime。str 视为 UTC（SQLite datetime('now') 约定）。"""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.astimezone().replace(tzinfo=None) if v.tzinfo else v
    s = str(v).replace("T", " ")[:19]
    dt = None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            dt = datetime.strptime(s[:len(fmt) + 2], fmt)
            break
        except ValueError:
            continue
    return _utc_to_local(dt) if dt else None


# ============ 档位判定（纯函数，单测锚点） ============

def judge_tiers(task, now=None):
    """输入 task dict（含 status/assignee/creator/deadline_at/created_at），返回命中的档位列表。"""
    now = now or datetime.now()
    status = (task.get("status") or "").strip()
    assignee = (task.get("assignee") or "").strip()
    tiers = []

    dl = _as_local_dt(task.get("deadline_at"))
    if status == "confirmed" and assignee and dl:
        if now > dl:
            tiers.append("overdue")
        else:
            if now >= dl - timedelta(hours=24):
                tiers.append("due_24h")
            if now.date() == dl.date():
                tiers.append("due_day")

    created = _created_local(task.get("created_at"))
    if status in UNRESOLVED_STATUS and not assignee and created:
        if now - created >= timedelta(hours=24):
            tiers.append("unassigned")

    return tiers


# ============ 文案与目标 ============

def _compose(task, tier):
    """返回 (提醒文案, 通知目标列表)。目标为用户显示名（MVP 约定）。"""
    content = (task.get("content") or "").strip()
    assignee = (task.get("assignee") or "").strip()
    creator = (task.get("creator") or "").strip()
    dl = _as_local_dt(task.get("deadline_at"))
    dl_str = dl.strftime("%m-%d %H:%M") if dl else (task.get("deadline") or "")

    if tier == "due_24h":
        text = f"⏰ 到期提醒：任务「{content}」将于 {dl_str}（24 小时内）到期，请留意进度。"
        targets = [assignee] + ([creator] if creator and creator != assignee else [])
    elif tier == "due_day":
        text = f"📅 今日到期：任务「{content}」今天（{dl_str}）截止，请推进收尾。"
        targets = [assignee]
    elif tier == "overdue":
        text = f"🔴 逾期提醒：任务「{content}」已超过截止时间（{dl_str}），请尽快处理或更新状态。"
        seen, targets = set(), []
        for x in (assignee, creator):
            if x and x not in seen:
                seen.add(x)
                targets.append(x)
    else:  # unassigned
        text = f"🔔 任务「{content}」发布超过 24 小时还没有负责人认领，请指派或跟进。"
        targets = [creator]
    return text, [x for x in targets if x]


# ============ 去重与发送 ============

def _already_sent(con, task_id, tier):
    c = con.cursor()
    c.execute("SELECT 1 FROM reminder_sent WHERE task_id=? AND tier=?", (task_id, tier))
    return c.fetchone() is not None


def _mark_sent(con, task_id, tier):
    c = con.cursor()
    c.execute("INSERT INTO reminder_sent(task_id, tier) VALUES(?,?)", (task_id, tier))
    con.commit()


def _maybe_group_writeback(con, task, text):
    """OpenIM 群回写：默认关（IMAI_REMIND_TO_GROUP）；无群归属的任务跳过。"""
    from imai import config as _cfg
    if not _cfg.REMIND_TO_GROUP:
        return
    grp = task.get("grp_id")
    if not grp:
        return
    try:
        from imai.integrations import openim_client
        openim_client.send_group_notice(str(grp), text)
        audit_log(con, "scheduler", "reminder_group_writeback",
                  {"taskId": task.get("id"), "grp": str(grp)})
    except Exception as e:
        audit_log(con, "scheduler", "reminder_group_writeback_error",
                  {"taskId": task.get("id"), "error": str(e)[:200]})


# ============ 主扫描 ============

def scan_once(con=None, now=None):
    """扫描一轮：回填 deadline_at → 逐任务判档 → 去重 → 发送。

    返回 {"backfilled": int, "sent": [{"taskId", "tier", "to"}]}。
    """
    now = now or datetime.now()
    own_con = con is None
    con = con or get_conn()
    try:
        backfilled = backfill_pending(con)

        c = con.cursor()
        c.execute("SELECT * FROM task WHERE status IN "
                  "('confirmed','pending_assignee','pending_confirmation')")
        tasks = [dict(r) for r in c.fetchall()]

        sent = []
        for t in tasks:
            for tier in judge_tiers(t, now=now):
                if _already_sent(con, t["id"], tier):
                    continue
                text, targets = _compose(t, tier)
                if not targets:
                    continue
                for target in targets:
                    ai_dm_send(con, target, text, task_id=t["id"])
                _mark_sent(con, t["id"], tier)
                audit_log(con, "scheduler", "reminder_sent",
                          {"taskId": t["id"], "tier": tier, "to": targets, "text": text[:80]})
                _maybe_group_writeback(con, t, text)
                bus.fanout("reminder", {"taskId": t["id"], "tier": tier,
                                        "to": targets, "text": text})
                sent.append({"taskId": t["id"], "tier": tier, "to": targets})
        return {"backfilled": backfilled, "sent": sent}
    finally:
        if own_con:
            con.close()
