#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G1 · 任务全生命周期（simulate_message → 看板 → 确认/驳回 → 事件/审计）"""
from tests.helpers import make_intent

MSG = "这次618复盘我来出物料清单，下周三前"


def test_g1_1_create_and_structure(client, fake_llm, db):
    """G1.1 明确认领话术 → task_created + pending_confirmation + 结构锁定"""
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前", assign_mode="self"))
    r = client.post("/api/simulate_message", json={"sender": "测试同事", "text": MSG})
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] is True
    ai = d["ai"]
    assert ai["action"] == "task_created"
    t = ai["task"]
    assert set(t.keys()) >= {"taskId", "content", "assignee", "deadline", "status"}
    assert t["status"] == "pending_confirmation"
    assert t["content"] == "出618复盘物料清单"
    assert t["deadline"] == "下周三前"
    # 进程内事件入队（现状：EVENTS，Step2 将换 Redis Streams）
    assert any(e.get("event") == "task.created" for e in core_events())
    # 消息已入库
    msgs = client.get("/api/messages").json()["messages"]
    assert any(m["content"] == MSG and m["sender_name"] == "测试同事" for m in msgs)
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='task_created'")[0]["n"] == 1


def core_events():
    from imai.config import EVENTS
    return list(EVENTS)


def test_g1_2_tasks_list_visible(client, fake_llm):
    """G1.2 任务列表可见且字段完整"""
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前", assign_mode="self"))
    created = client.post("/api/simulate_message", json={"sender": "测试同事", "text": MSG}).json()
    tid = created["ai"]["task"]["taskId"]

    tasks = client.get("/api/tasks").json()["tasks"]
    row = [t for t in tasks if t["id"] == tid]
    assert len(row) == 1
    row = row[0]
    for k in ("id", "content", "creator", "assignee", "deadline", "status", "confidence"):
        assert k in row, f"缺字段 {k}"
    assert row["status"] == "pending_confirmation"
    assert row["creator"] == "测试同事"
    # status 过滤参数可用
    only_confirmed = client.get("/api/tasks", params={"status": "confirmed"}).json()["tasks"]
    assert all(t["status"] == "confirmed" for t in only_confirmed)


def test_g1_3_confirm_flow(client, fake_llm, db):
    """G1.3 人审确认 → confirmed + audit + reminder 语义锁定"""
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前", assign_mode="self"))
    tid = client.post("/api/simulate_message",
                      json={"sender": "测试同事", "text": MSG}).json()["ai"]["task"]["taskId"]

    r = client.post(f"/api/tasks/{tid}/confirm", json={})
    assert r.status_code == 200 and r.json()["ok"] is True

    row = db.query("SELECT * FROM task WHERE id=?", (tid,))[0]
    assert row["status"] == "confirmed"
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='confirm'")[0]["n"] == 1


def test_g1_4_reject_flow(client, fake_llm, db):
    """G1.4 驳回 → rejected + audit reject
    【现状缺陷登记】reject 理由提取正则过宽（core._memorize_reject_signal）：
    含『不是』等触发词的中性句子会被误提取人名沉淀术语，详见 g1_4b。"""
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前", assign_mode="self"))
    tid = client.post("/api/simulate_message",
                      json={"sender": "测试同事", "text": MSG}).json()["ai"]["task"]["taskId"]

    r = client.post(f"/api/tasks/{tid}/reject", json={"reason": "信息有误，感谢纠正"})
    assert r.status_code == 200 and r.json()["ok"] is True

    assert db.query("SELECT * FROM task WHERE id=?", (tid,))[0]["status"] == "rejected"
    audits = db.query("SELECT detail FROM audit WHERE action='reject'")
    assert len(audits) == 1
    import json as _j
    assert _j.loads(audits[0]["detail"])["reason"] == "信息有误，感谢纠正"
    # 无触发词的理由：不沉淀任何 term
    assert db.query("SELECT COUNT(*) AS n FROM term")[0]["n"] == 0


def test_g1_4b_regex_overcapture_current_state(client, fake_llm, db):
    """【现状缺陷锁定】中性驳回理由『这不是任务』会误提取『任务』为人名并沉淀术语。
    这是 core._memorize_reject_signal 正则 (?:应该是|是|改为|...)([\u4e00-\u9fa5]{2,4})
    的过宽捕获——后续修复时应翻转本断言（期望：不产生 人称:任务）。"""
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前", assign_mode="self"))
    tid = client.post("/api/simulate_message",
                      json={"sender": "测试同事", "text": MSG}).json()["ai"]["task"]["taskId"]
    client.post(f"/api/tasks/{tid}/reject", json={"reason": "这不是任务"})

    terms = db.query("SELECT term, source FROM term")
    hit = [t for t in terms if t["term"] == "人称:任务"]
    assert len(hit) == 1 and hit[0]["source"] == "corrected", \
        "现状应为误沉智人称:任务；若本断言失败说明正则已收紧，请更新 Spec 与本用例"


def test_g1_5_duplicate_delivery_current_state(client, fake_llm, db):
    """G1.5【现状记录·非理想断言】同消息重复投递会产生两张任务。
    《架构分析报告》问题 D / Step2 幂等化输入证据：现状无 msgId 去重。
    本用例仅锁定『重复会复制任务』这一现状；若未来实现去重，此断言应同步翻转。"""
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前", assign_mode="self"))
    payload = {"sender": "测试同事", "text": MSG}
    r1 = client.post("/api/simulate_message", json=payload).json()
    r2 = client.post("/api/simulate_message", json=payload).json()
    assert r1["ai"]["action"] == r2["ai"]["action"] == "task_created"
    n = db.query(
        "SELECT COUNT(*) AS n FROM task WHERE content=? AND creator=? AND status='pending_confirmation'",
        ("出618复盘物料清单", "测试同事"))[0]["n"]
    assert n == 2, "现状应为重复创建两条（去重缺口实证）；若断言失败说明去重已实现，请更新本用例与 Spec"
