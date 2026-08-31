#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""每日汇总兑底推送测试（Spec：每日汇总兑底Spec.md）

四通道断言：ai_dm 落库 / digest_sent 日期幂等 / audit(action=daily_digest_pushed) / SSE fanout。
不启动调度线程（conftest 已全局 REMIND_INTERVAL_SEC=0），直接调 scan_and_push。
"""
from datetime import datetime

from imai.db import get_conn
from imai.repos import audit_recent, insert_task
from imai.services import bus
from imai.services.ai_dm import ai_dm_list
from imai.services.digest import scan_and_push

# 与 test_scheduler 同风格：固定扫描时刻（周五）
AFTER_GATE = datetime(2026, 8, 28, 18, 5)     # 过了 18:00 兑底点
BEFORE_GATE = datetime(2026, 8, 28, 10, 0)    # 未到
NEXT_DAY = datetime(2026, 8, 29, 18, 5)


def _mk_pending(con, content="写周报", creator="李娜(娜姐)"):
    """建一条未确认归属任务（pending_confirmation，无负责人）。"""
    return insert_task(con, content, creator, None, "周五前", "pending_confirmation", "high", "msg-d")


def test_before_gate_no_push():
    """未到兑底点：不推送、不落 digest_sent、不产生 ai_dm。"""
    con = get_conn()
    try:
        _mk_pending(con)
        r = scan_and_push(con, now=BEFORE_GATE)
        assert r["pushed"] is False and r["reason"] == "before_time"
        c = con.cursor()
        c.execute("SELECT count(*) AS n FROM digest_sent")
        assert c.fetchone()["n"] == 0
        assert ai_dm_list(con) == []
    finally:
        con.close()


def test_after_gate_pushes_once():
    """到点首扫：推送清单给兑底管理员，ai_dm/audit/fanout/digest_sent 四通道齐动；当日重扫幂等。"""
    con = get_conn()
    try:
        _mk_pending(con)
        events = []
        bus.fanout = (lambda et, p: events.append(et))  # 局部观察 fanout
        r1 = scan_and_push(con, now=AFTER_GATE)
        assert r1["pushed"] is True and r1["count"] == 1
        assert r1["to"] == ["user001"]                  # role 表空 → 兑底管理员
        dms = [r["content"] for r in ai_dm_list(con) if r["sender_id"] == "user001"]
        assert len(dms) == 1 and "每日汇总" in dms[0] and "写周报" in dms[0]
        c = con.cursor()
        c.execute("SELECT digest_date, count FROM digest_sent")
        rows = c.fetchall()
        assert len(rows) == 1 and rows[0]["digest_date"] == "2026-08-28" and rows[0]["count"] == 1
        audits = [a for a in audit_recent(con, 20) if a["action"] == "daily_digest_pushed"]
        assert len(audits) == 1
        assert events == ["digest"]
        # 当日重扫：幂等不重发
        r2 = scan_and_push(con, now=datetime(2026, 8, 28, 19, 0))
        assert r2["pushed"] is False and r2["reason"] == "already_sent"
        assert len([r for r in ai_dm_list(con) if r["sender_id"] == "user001"]) == 1
    finally:
        con.close()


def test_next_day_pushes_again():
    """跨天：次日到点再次推送（每只兜底一次/日）。"""
    con = get_conn()
    try:
        _mk_pending(con)
        assert scan_and_push(con, now=AFTER_GATE)["pushed"] is True
        assert scan_and_push(con, now=NEXT_DAY)["pushed"] is True
        c = con.cursor()
        c.execute("SELECT digest_date FROM digest_sent ORDER BY digest_date")
        assert [r["digest_date"] for r in c.fetchall()] == ["2026-08-28", "2026-08-29"]
    finally:
        con.close()


def test_admin_recipients_from_role():
    """role 表有 admin → 推给所有管理员而非兑底人；无待确认任务 → 空清单文案仍推送。"""
    con = get_conn()
    try:
        c = con.cursor()
        c.execute("INSERT INTO role(oim_user_id, role) VALUES('boss01','admin'),('boss02','admin')")
        con.commit()
        r = scan_and_push(con, now=AFTER_GATE)
        assert r["pushed"] is True and r["to"] == ["boss01", "boss02"] and r["count"] == 0
        texts = [x["content"] for x in ai_dm_list(con) if x["sender_id"] == "boss01"]
        assert texts and "暂无待确认" in texts[0]
    finally:
        con.close()
