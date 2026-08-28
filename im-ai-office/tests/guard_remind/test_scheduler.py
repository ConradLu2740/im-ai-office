#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""提醒调度集成测试（迭代 1 补齐；Spec §3：造任务 → 操纵时间 → 调 scan_once → 断言四通道）

四通道断言：ai_dm 落库 / reminder_sent 去重表 / audit(action=reminder_sent) / SSE fanout。
不启动调度线程（conftest 已全局 REMIND_INTERVAL_SEC=0），直接调 scan_once。
"""
import json
from datetime import datetime, timedelta, timezone

import pytest

from imai.db import get_conn
from imai.repos import insert_task, audit_recent
from imai.services import bus
from imai.services.ai_dm import ai_dm_list
from imai.services.reminder import scan_once

# 固定扫描时刻：2026-08-28 10:00（周五）
NOW = datetime(2026, 8, 28, 10, 0)


def _utc_str_for_local(dt_local):
    """把本地 naive 时间转为 SQLite created_at 的 UTC 文本（datetime('now') 约定）。"""
    local_tz = datetime.now().astimezone().tzinfo
    return dt_local.replace(tzinfo=local_tz).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _mk_task(con, content="写周报", creator="李娜(娜姐)", assignee="张伟",
             deadline=None, status="confirmed", deadline_at=None, created_age_h=None):
    tid = insert_task(con, content, creator, assignee, deadline, status, "high", "msg-x")
    c = con.cursor()
    if deadline_at:
        c.execute("UPDATE task SET deadline_at=? WHERE id=?", (deadline_at, tid))
    if created_age_h is not None:
        c.execute("UPDATE task SET created_at=? WHERE id=?",
                  (_utc_str_for_local(NOW - timedelta(hours=created_age_h)), tid))
    con.commit()
    return tid


def _dm_targets(con):
    return [(r["sender_id"], r["task_id"]) for r in ai_dm_list(con)]


def _sent_tiers(con):
    c = con.cursor()
    c.execute("SELECT task_id, tier FROM reminder_sent ORDER BY id")
    return [(r["task_id"], r["tier"]) for r in c.fetchall()]


# ============ 接线：backfill ============

def test_scan_backfills_deadline_at():
    """识别链路接线：deadline 文本 → 扫描一轮自动回填 deadline_at（Spec §1.3 每轮回填）。"""
    con = get_conn()
    try:
        tid = _mk_task(con, deadline="明天")
        summary = scan_once(con, now=NOW)
        assert summary["backfilled"] >= 1
        c = con.cursor()
        c.execute("SELECT deadline_at FROM task WHERE id=?", (tid,))
        assert c.fetchone()["deadline_at"] == "2026-08-29 23:59"
    finally:
        con.close()


# ============ 档位与发送 ============

def test_due_day_and_due_24h_same_day():
    """到期当天：due_24h（负责人+发起人抄送）与 due_day（负责人）双档齐发。"""
    con = get_conn()
    try:
        tid = _mk_task(con, deadline_at="2026-08-28 23:59")
        summary = scan_once(con, now=NOW)
        tiers = {s["tier"]: s["to"] for s in summary["sent"]}
        assert set(tiers) == {"due_24h", "due_day"}
        assert tiers["due_24h"] == ["张伟", "李娜(娜姐)"]
        assert tiers["due_day"] == ["张伟"]
        assert ("张伟", tid) in _dm_targets(con)
        assert ("李娜(娜姐)", tid) in _dm_targets(con)
        assert sorted(_sent_tiers(con)) == [(tid, "due_24h"), (tid, "due_day")]
    finally:
        con.close()


def test_due_24h_only_before_day():
    """明天凌晨到期：只有 due_24h（还不到 due_day 当天）。"""
    con = get_conn()
    try:
        _mk_task(con, deadline_at="2026-08-29 00:30")
        summary = scan_once(con, now=NOW)
        assert [s["tier"] for s in summary["sent"]] == ["due_24h"]
    finally:
        con.close()


def test_overdue_marks_both():
    """逾期：@负责人 + 发起人， overdue 标记文案。"""
    con = get_conn()
    try:
        tid = _mk_task(con, deadline_at="2026-08-28 09:00")   # now-1h
        summary = scan_once(con, now=NOW)
        assert [s["tier"] for s in summary["sent"]] == ["overdue"]
        assert summary["sent"][0]["to"] == ["张伟", "李娜(娜姐)"]
        text = [r["content"] for r in ai_dm_list(con) if r["sender_id"] == "张伟"][0]
        assert "逾期" in text and "写周报" in text
        assert ("张伟", tid) in _sent_tiers(con) or (tid, "overdue") in _sent_tiers(con)
    finally:
        con.close()


def test_unassigned_over_24h_reminds_creator_only():
    """无负责人超 24h：只提醒发起人。"""
    con = get_conn()
    try:
        tid = _mk_task(con, assignee=None, status="pending_confirmation",
                       deadline=None, created_age_h=25)
        summary = scan_once(con, now=NOW)
        assert [s["tier"] for s in summary["sent"]] == ["unassigned"]
        assert summary["sent"][0]["to"] == ["李娜(娜姐)"]
        assert ("李娜(娜姐)", tid) in _dm_targets(con)
        assert all(r["sender_id"] != "张伟" for r in ai_dm_list(con))
    finally:
        con.close()


def test_unassigned_within_24h_silent():
    con = get_conn()
    try:
        _mk_task(con, assignee=None, status="pending_confirmation", created_age_h=1)
        summary = scan_once(con, now=NOW)
        assert summary["sent"] == []
    finally:
        con.close()


def test_future_and_rejected_ignored():
    """未到期 / 已驳回：不出任何提醒（confirmed 门槛）。"""
    con = get_conn()
    try:
        _mk_task(con, deadline_at="2026-09-10 23:59")
        _mk_task(con, deadline_at="2026-08-28 09:00", status="rejected")
        summary = scan_once(con, now=NOW)
        assert summary["sent"] == []
        assert _dm_targets(con) == []
    finally:
        con.close()


def test_pending_confirmation_with_assignee_not_due_reminded():
    """pending_confirmation 但已有负责人、未逾期：不进到期档（等 confirmed）。"""
    con = get_conn()
    try:
        _mk_task(con, status="pending_confirmation", deadline_at="2026-08-28 09:00")
        summary = scan_once(con, now=NOW)
        assert summary["sent"] == []
    finally:
        con.close()


# ============ 去重与通道 ============

def test_second_scan_no_duplicate():
    """reminder_sent UNIQUE(task_id, tier)：第二轮扫描零重发。"""
    con = get_conn()
    try:
        _mk_task(con, deadline_at="2026-08-28 23:59")
        first = scan_once(con, now=NOW)
        assert first["sent"]
        dm_after_first = len(ai_dm_list(con))
        second = scan_once(con, now=NOW)
        assert second["sent"] == []
        assert len(ai_dm_list(con)) == dm_after_first
        assert audit_recent(con, 50) is not None
    finally:
        con.close()


def test_sse_fanout_event():
    """每次发送同步 fanout 一个 reminder 事件（SSE 实时通知）。"""
    con = get_conn()
    try:
        q = bus.subscribe()
        _mk_task(con, deadline_at="2026-08-28 23:59")
        scan_once(con, now=NOW)
        line = q.get(timeout=2)
        evt = json.loads(line)
        assert evt["type"] == "reminder"
        assert evt["tier"] in ("due_24h", "due_day")
        assert evt["taskId"] >= 1
    finally:
        con.close()
        bus.unsubscribe(q)


def test_audit_channel():
    """审计通道：action=reminder_sent，detail 含 tier 与目标。"""
    con = get_conn()
    try:
        _mk_task(con, deadline_at="2026-08-28 23:59")
        scan_once(con, now=NOW)
        audits = [a for a in audit_recent(con, 20) if a["action"] == "reminder_sent"]
        assert len(audits) == 2
        assert audits[0]["actor"] == "scheduler"
    finally:
        con.close()
