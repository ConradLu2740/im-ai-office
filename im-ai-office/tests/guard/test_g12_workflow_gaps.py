#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G12 · 工作流缺口修复（工作流缺口登记与完成回流Spec，2026-09-02）

G1 完成回流 / G3 发送留痕 / G4 deadline_unparsed 可观测
"""
from imai.services import bus
from imai.services.reminder import judge_tiers
from tests.helpers import make_intent


def _mk_confirmed_task(db, content="出季度数据报表", assignee="user001", deadline="周五前"):
    db.exec("INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg) "
            " VALUES(?,?,?,?,?,?,?)",
            (content, "user001", assignee, deadline, "confirmed", "high", "s-g12"))
    return db.query("SELECT id FROM task WHERE content=? ORDER BY id DESC LIMIT 1", (content,))[0]["id"]


def test_g12_1_complete_endpoint_flips_to_done(client, db):
    """G12.1 完成端点：confirmed → done + audit；二次完成拒绝"""
    tid = _mk_confirmed_task(db)
    r = client.post(f"/api/tasks/{tid}/complete", json={"actor": "user001"}).json()
    assert r["ok"] is True
    row = db.query("SELECT status FROM task WHERE id=?", (tid,))[0]
    assert row["status"] == "done"
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='task_completed'")[0]["n"] >= 1
    # 二次完成：done 不在可流转集合 → 拒绝
    r2 = client.post(f"/api/tasks/{tid}/complete", json={"actor": "user001"}).json()
    assert r2["ok"] is False


def test_g12_2_done_never_overdue():
    """G12.2 done 任务不触发任何提醒档位（逾期提醒永动缺口收口）"""
    t = {"status": "done", "assignee": "user001", "deadline": "周五",
         "deadline_at": "2026-08-01 10:00", "created_at": "2026-08-01 09:00"}
    assert judge_tiers(t) == []


def test_g12_3_chat_completion_marks_done(client, fake_llm, db):
    """G12.3 口头完成：is_completion 命中 → 该成员最近确认任务 done；无匹配则 skip 不动"""
    tid = _mk_confirmed_task(db, content="写周报", assignee="user001")
    fake_llm.route("周报做完了", **{"is_task": False, "confidence": "low",
                                 "is_completion": True, "content": "周报"})
    r = client.post("/api/sdk_message", json={
        "sender": "user001", "text": "周报做完了", "conv_id": "sg_g12",
        "send_id": "user001", "client_msg_id": "g12-cmid-1"}).json()
    assert r["ai"]["action"] == "task_completed"
    assert db.query("SELECT status FROM task WHERE id=?", (tid,))[0]["status"] == "done"
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='task_completed'")[0]["n"] >= 1
    # 无匹配：完成者没有任务 → 不动任何任务
    fake_llm.route("另一个事搞定了", **{"is_task": False, "confidence": "low",
                                     "is_completion": True, "content": "另一个事"})
    r2 = client.post("/api/sdk_message", json={
        "sender": "nobody999", "text": "另一个事搞定了", "conv_id": "sg_g12",
        "send_id": "nobody999", "client_msg_id": "g12-cmid-2"}).json()
    assert r2["ai"]["action"] == "skip"
    assert db.query("SELECT COUNT(*) AS n FROM task WHERE status='done' AND content='写周报'")[0]["n"] == 1


def test_g12_4_send_message_audited(client, monkeypatch, db):
    """G12.4（G3 缓解）：发送端点每次调用留痕（actor/ip）"""
    from imai.api import routes_openim
    monkeypatch.setattr(routes_openim, "_openim_post",
                        lambda path, payload, token=None: {"errCode": 0, "data": {"serverMsgID": "srv-g12"}})
    client.post("/openim/send_message", json={
        "user_id": "user001", "group_id": "g1", "sender_name": "user001",
        "text": "hello", "client_msg_id": "cmid-g12-4"}).json()
    audits = db.query("SELECT actor, detail FROM audit WHERE action='send_message'")
    assert len(audits) == 1 and audits[0]["actor"] == "user:user001"


def test_g12_5_deadline_unparsed_observed(client, db):
    """G12.5（G4）：不可解析截止 → deadline_unparsed 审计一次，回填不重复记"""
    db.exec("INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg) "
            " VALUES('玄学任务','李娜(娜姐)','张三','宇宙末日之前','confirmed','high','s-g12-5')")
    from imai.services.deadline_parser import backfill_pending
    from imai.db import get_conn
    con = get_conn()
    try:
        backfill_pending(con)
        backfill_pending(con)   # 二轮：不重复记
    finally:
        con.close()
    rows = db.query("SELECT detail FROM audit WHERE action='deadline_unparsed'")
    assert len(rows) == 1
