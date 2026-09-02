#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G11 · 网关收敛（网关收敛Spec，2026-09-02）

锁定三条新不变量：
1. 回调是唯一落库+AI 入口，且落库后广播 SSE message 事件
2. /openim/send_message 为纯 REST 代发：透传 clientMsgID/senderPlatformID，不落库不跑 AI
3. 回调同 clientMsgID 重投递被永久幂等闸门拦截
"""
import json
import queue

from imai.services import bus


def test_g11_1_callback_persists_and_fans_out_sse(client, fake_llm, db):
    """G11.1 群消息回调：落库 + SSE message 事件（字段齐全）"""
    fake_llm.route("随便聊聊天气", **{"is_task": False, "confidence": "low"})
    q = bus.subscribe()
    try:
        r = client.post("/callback", json={
            "msgID": "g11-m1", "groupID": "g11grp", "sendID": "user002",
            "senderNickname": "张三", "contentType": "101",
            "content": "随便聊聊天气", "clientMsgID": "cmid-g11-1",
        }).json()
        assert r["ok"] is True
        # 落库
        rows = db.query("SELECT * FROM message WHERE conv_id='sg_g11grp' AND client_msg_id='cmid-g11-1'")
        assert len(rows) == 1 and rows[0]["content"] == "随便聊聊天气"
        # SSE 事件
        ev = json.loads(q.get(timeout=3))
        assert ev["type"] == "message"
        assert ev["conv_id"] == "sg_g11grp"
        assert ev["send_id"] == "user002"
        assert ev["sender_nickname"] == "张三"
        assert ev["content"] == "随便聊聊天气"
        assert ev["client_msg_id"] == "cmid-g11-1"
    finally:
        bus.unsubscribe(q)


def test_g11_2_send_is_pure_rest_relay(client, monkeypatch, db):
    """G11.2 发送端点：透传 clientMsgID/senderPlatformID=4；不落库不建任务"""
    from imai.api import routes_openim
    captured = {}

    def _fake_post(path, payload, token=None):
        captured["path"] = path
        captured["payload"] = payload
        return {"errCode": 0, "data": {"serverMsgID": "srv-1"}}

    monkeypatch.setattr(routes_openim, "_openim_post", _fake_post)
    # 缺 client_msg_id → 400 语义拒绝
    bad = client.post("/openim/send_message", json={
        "user_id": "user001", "group_id": "g1", "text": "hi"}).json()
    assert bad["ok"] is False and "client_msg_id" in bad["error"]
    # 正常发送：payload 透传，且无落库无任务
    r = client.post("/openim/send_message", json={
        "user_id": "user001", "group_id": "g1", "sender_name": "user001",
        "text": "安排个事", "client_msg_id": "cmid-send-1"}).json()
    assert r["ok"] is True and r["client_msg_id"] == "cmid-send-1"
    assert captured["payload"]["clientMsgID"] == "cmid-send-1"
    assert captured["payload"]["senderPlatformID"] == 4
    assert captured["payload"]["content"]["content"] == "安排个事"
    assert db.query("SELECT COUNT(*) AS n FROM message WHERE client_msg_id='cmid-send-1'")[0]["n"] == 0
    assert db.query("SELECT COUNT(*) AS n FROM task")[0]["n"] == 0


def test_g11_3_callback_client_msg_id_idempotent(client, fake_llm, db):
    """G11.3 同 clientMsgID 重投递：二次回调被闸门拦截，不重复落库/建任务"""
    from tests.helpers import make_intent
    fake_llm.route("周五前交周报", **make_intent(content="交周报", assignee_hint="我",
                                              deadline_hint="周五前", assign_mode="self"))
    payload = {
        "msgID": "g11-m3", "groupID": "g11grp3", "sendID": "user001",
        "senderNickname": "user001", "contentType": "101",
        "content": "周五前交周报", "clientMsgID": "cmid-g11-3",
    }
    r1 = client.post("/callback", json=payload).json()
    r2 = client.post("/callback", json=payload).json()
    assert r2.get("action") == "client_msg_id_seen"
    assert db.query("SELECT COUNT(*) AS n FROM message WHERE client_msg_id='cmid-g11-3'")[0]["n"] == 1
    assert db.query("SELECT COUNT(*) AS n FROM task WHERE content LIKE '%周报%'")[0]["n"] == 1
