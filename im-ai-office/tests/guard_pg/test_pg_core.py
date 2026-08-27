#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PG 方言等价核心用例：与 Guard sync 同语义，验证存储/查询/翻译在 Postgres 上成立"""
from tests.guard_async.test_async_flow import INTENT_AMBIG, INTENT_SELF
from tests.helpers import make_intent

MSG_SELF = "618复盘物料清单我来出，周五前"
MSG_AMBIG = "让小张跟一下供应商比价"


def test_task_create_and_list(pg_backend, fake_llm, db):
    fake_llm.route(MSG_SELF, **INTENT_SELF)
    result = __import__("imai.services.pipeline", fromlist=["process_message"]).process_message(
        MSG_SELF, "李娜(娜姐)")
    assert result["action"] == "task_created"
    task = result["task"]
    assert task["status"] == "pending_confirmation" and task["assignee"] == "李娜(娜姐)"

    from imai.repos import get_task_dict, list_task_dicts
    row = get_task_dict(db.query.__self__ if False else _con(), task["taskId"])
    assert row["content"] == "出618复盘物料清单"
    assert list_task_dicts(_con(), status="pending_confirmation")


def _con():
    from imai.db import get_conn
    return get_conn()


def test_confirm_and_reject_flow(pg_backend, fake_llm, db):
    fake_llm.route(MSG_SELF, **INTENT_SELF)
    result = __import__("imai.services.pipeline", fromlist=["process_message"]).process_message(
        MSG_SELF, "李娜(娜姐)")
    tid = result["task"]["taskId"]

    from imai.db import get_conn
    from imai.repos import get_task_dict, list_task_dicts
    from imai.services.tasks import confirm_task, reject_task
    con = get_conn()
    try:
        assert confirm_task(con, tid) is True
        assert get_task_dict(con, tid)["status"] == "confirmed"
        assert reject_task(con, tid, reason="信息有误") is True
        assert get_task_dict(con, tid)["status"] == "rejected"
        audits = [a["action"] for a in db.query("SELECT action FROM audit")]
        assert "confirm" in audits and "reject" in audits
    finally:
        con.close()


def test_ambiguous_disambiguation(pg_backend, fake_llm, db):
    """双别名消歧在 PG 上语义一致（含 pending_meta JSON 往返）"""
    fake_llm.route(MSG_AMBIG, **INTENT_AMBIG)
    result = __import__("imai.services.pipeline", fromlist=["process_message"]).process_message(
        MSG_AMBIG, "李娜(娜姐)")
    assert result["action"] == "confirm_assignee"
    labels = [c["label"] for c in result["task"]["candidates"]]
    assert sorted(labels) == ["张伟(小张)", "张敏(小张)"]

    from imai.db import get_conn
    from imai.services.ai_dm import resolve_task_by_choice
    con = get_conn()
    try:
        # sender 语义：无 ai_dm 记录时回退按 creator 匹配 pending_assignee 任务
        r = resolve_task_by_choice(con, "李娜(娜姐)", "1")
        assert r["ok"] is True and r["assignee"] == "张伟(小张)"
        row = db.query("SELECT status, pending_meta FROM task ORDER BY id DESC LIMIT 1")[0]
        assert row["status"] == "confirmed" and row["pending_meta"] is None
    finally:
        con.close()


def test_dedup_window(pg_backend, db):
    from imai.services import bus
    bus.mark_consumed(con := _con(), "evt_pg_1")
    assert bus.is_duplicate(con, "evt_pg_1") is True
    assert bus.is_duplicate(con, "evt_pg_2") is False
    con.close()


def test_memory_injection_and_proofs(pg_backend, db):
    from imai.db import get_conn
    from imai.services.memory import add_term, build_sys_ctx, memory_proofs, set_grp_meta
    con = get_conn()
    try:
        set_grp_meta(con, "sg_pg", intro="产品讨论群")
        add_term(con, "红字版", "红色修订版")
        ctx = build_sys_ctx(con, "sg_pg")
        assert "【群简介】产品讨论群" in ctx and "红字版=红色修订版" in ctx
        assert "小张=张伟" in ctx and "娜姐=李娜" in ctx
        proofs = memory_proofs(con, "这个要用红字版发，找娜姐就行")
        kinds = {(p["type"], p["term"]) for p in proofs}
        assert ("term", "红字版") in kinds and ("person", "娜姐") in kinds
    finally:
        con.close()


def test_daily_summary(pg_backend, db):
    db.exec("INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg)"
            " VALUES('出周报','李娜(娜姐)','待指派','周五前','pending_confirmation','high','s1')")
    db.exec("INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg)"
            " VALUES('已完成','张三','张三',NULL,'confirmed','high','s2')")
    from imai.db import get_conn
    from imai.services.memory import build_daily_summary
    con = get_conn()
    try:
        sm = build_daily_summary(con)
        assert sm["count"] == 1 and "出周报" in sm["text"]
    finally:
        con.close()


def test_role_roundtrip(pg_backend, db):
    from imai.db import get_conn
    from imai.services.rbac import get_role, set_role
    con = get_conn()
    try:
        set_role(con, "user001", "group_admin")
        assert get_role(con, "user001") == "group_admin"
        assert get_role(con, "nobody") == "member"
        assert get_role(con, "imAdmin") == "group_admin"
    finally:
        con.close()
