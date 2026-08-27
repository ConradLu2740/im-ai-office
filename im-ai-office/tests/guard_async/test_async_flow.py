#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Async 行为守卫：受理结构 / 终态一致 / 幂等去重 / SSE 事件 / worker 审计"""
import threading
import time

from tests.guard_async.conftest import drain_worker, wait_audit, wait_task

MSG_SELF = "618复盘物料清单我来出，周五前"
MSG_AMBIG = "让小张跟一下供应商比价"

INTENT_SELF = {"is_task": True, "confidence": "high", "content": "出618复盘物料清单",
               "assignee_hint": "我", "deadline_hint": "周五前", "assign_mode": "self"}
INTENT_AMBIG = {"is_task": True, "confidence": "medium", "content": "跟进供应商比价",
                "assignee_hint": "小张", "deadline_hint": None, "assign_mode": "third_party"}


def test_accept_simulate(async_client):
    """A1 simulate_message 受理结构：accepted + queued_event + 确定性 msg_id，无同步 ai 结果"""
    d = async_client.post("/api/simulate_message",
                          json={"sender": "李娜(娜姐)", "text": MSG_SELF}).json()
    assert d["ok"] is True and d["accepted"] is True
    assert d["queued_event"].count("-") == 1           # stream id 形如 ts-seq
    assert d["msg_id"].startswith("evt_")
    assert "ai" not in d                                # 行为分叉点：不再同步返回判定
    # 相同输入 → 相同确定性 msgId
    d2 = async_client.post("/api/simulate_message",
                           json={"sender": "李娜(娜姐)", "text": MSG_SELF}).json()
    assert d2["msg_id"] == d["msg_id"]


def test_accept_sdk_and_callback(async_client):
    """A2 sdk_message 与 /callback 受理结构（callback 透传 msgID 作幂等键）"""
    d1 = async_client.post("/api/sdk_message",
                           json={"sender": "李娜(娜姐)", "text": "服务器巡检我来安排"}).json()
    assert d1["accepted"] is True and "ai" not in d1

    d2 = async_client.post("/callback", json={
        "msgID": "cb-asynctest-1", "groupID": "sg_gtest", "sendID": "user001",
        "senderNickname": "李娜(娜姐)", "contentType": "101", "content": MSG_AMBIG,
    }).json()
    assert d2["ok"] is True and d2["accepted"] is True
    assert drain_worker("cb-asynctest-1"), "worker 应排空该回调消息"
    assert "handled" not in d2                          # 不再同步处理语义


def test_eventual_task_state(async_client, fake_llm):
    """A3 终态一致：异步消费产生与 sync 相同语义的任务（self 认领 + 截止）+ latency 埋点"""
    fake_llm.route(MSG_SELF, **INTENT_SELF)
    async_client.post("/api/simulate_message",
                      json={"sender": "李娜(娜姐)", "text": MSG_SELF})
    task = wait_task(async_client, "出618复盘物料清单", timeout=10)
    assert task, "10s 内未看到异步产生的任务"
    assert task["status"] == "pending_confirmation"
    assert task["assignee"] == "李娜(娜姐)"
    assert task["deadline"] == "周五前"
    processed = wait_audit("ai_processed", contains="618", timeout=6)
    assert processed and "latency_ms" in (processed.get("detail") or ""), \
        "worker 应写含 latency_ms 的 ai_processed 审计"


def test_replay_within_window_deduped(async_client, fake_llm):
    """A4 幂等反转（治理缺陷#3）：窗口内重放不重复建任务；g1_5 锁定的是 sync 现状"""
    fake_llm.route(MSG_SELF, **INTENT_SELF)
    payload = {"sender": "李娜(娜姐)", "text": MSG_SELF}
    async_client.post("/api/simulate_message", json=payload)
    first = wait_task(async_client, "出618复盘物料清单")
    assert first
    async_client.post("/api/simulate_message", json=payload)       # 重放
    time.sleep(2.5)                                                # 给足 worker 处理与 dedup 判定时间
    tasks = async_client.get("/api/tasks").json()["tasks"]
    n = len([t for t in tasks if "618复盘物料清单" in (t.get("content") or "")])
    assert n == 1, f"async 下重放不应重复建任务，实得 {n}"
    skip_hit = wait_audit("ai_dedup_skip", timeout=5)
    assert skip_hit, "应存在 ai_dedup_skip 审计证据"


def test_ambiguous_flow_via_worker(async_client, fake_llm):
    """A5 歧义经 worker：pending_assignee + ai_dm 出站确认卡 + OpenIM 私聊 stub 收集"""
    fake_llm.route(MSG_AMBIG, **INTENT_AMBIG)
    async_client.post("/callback", json={
        "msgID": "cb-amb-worker-1", "groupID": "sg_x", "sendID": "user001",
        "senderNickname": "李娜(娜姐)", "contentType": "101", "content": MSG_AMBIG,
    })
    task = wait_task(async_client, "跟进供应商比价")
    assert task and task["status"] == "pending_assignee"
    dms = async_client.get("/api/ai_dm", params={"sender_id": "user001"}).json()["messages"]
    assert any("【IMAI 任务确认】" in m["content"] for m in dms), "应有私聊确认卡出站记录"
    privates = async_client.openim_sends["sent_private"]
    assert privates, "worker 应触发 OpenIM 私聊推送（stub 收集）"


def test_sse_stream_receives_event(async_client, fake_llm):
    """A6 SSE 数据源收到 task_created 事件（直测 bus 订阅层=流内容同源；fake_llm 保证确定性）"""
    frames = []
    got = threading.Event()

    def _listen():
        from imai.services.bus import subscribe, unsubscribe
        q = subscribe()
        try:
            frames.append(q.get(timeout=12))
            got.set()
        except Exception:
            pass
        finally:
            unsubscribe(q)

    t = threading.Thread(target=_listen, daemon=True)
    t.start()
    time.sleep(0.3)                                    # 确保 listener 注册先于事件
    fake_llm.route(MSG_SELF, **INTENT_SELF)            # 固定 AI 输出，消除模型抖动
    async_client.post("/api/simulate_message",
                      json={"sender": "李娜(娜姐)", "text": MSG_SELF})
    t.join(timeout=13)
    assert got.is_set() and '"task_created"' in (frames[0] if frames else ""), \
        f"SSE 未收到事件: {frames}"


def test_sse_endpoint_contract(async_client):
    """A7 SSE 端点契约：单元级直验（不起真无限流，TestClient 流式消费会阻塞）"""
    import asyncio
    from imai.api.routes_events import events_stream
    resp = events_stream()
    assert resp.status_code == 200
    assert resp.media_type == "text/event-stream"
    # async 生成器直取首帧：应为 connected 注释帧
    first = asyncio.run(resp.body_iterator.__anext__())
    assert ": connected" in first
