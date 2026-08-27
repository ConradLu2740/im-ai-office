#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G1 · 任务全生命周期（simulate_message → 看板 → 确认/驳回 → 事件/审计）"""
import json as _j

from imai.config import EVENTS
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
    assert any(e.get("event") == "task.created" for e in list(EVENTS))
    # 消息已入库
    msgs = client.get("/api/messages").json()["messages"]
    assert any(m["content"] == MSG and m["sender_name"] == "测试同事" for m in msgs)
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='task_created'")[0]["n"] == 1


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
    only_confirmed = client.get("/api/tasks", params={"status": "confirmed"}).json()["tasks"]
    assert all(t["status"] == "confirmed" for t in only_confirmed)


def test_g1_3_confirm_flow(client, fake_llm, db):
    """G1.3 人审确认 → confirmed + audit"""
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前", assign_mode="self"))
    tid = client.post("/api/simulate_message",
                      json={"sender": "测试同事", "text": MSG}).json()["ai"]["task"]["taskId"]

    r = client.post(f"/api/tasks/{tid}/confirm", json={})
    assert r.status_code == 200 and r.json()["ok"] is True

    assert db.query("SELECT * FROM task WHERE id=?", (tid,))[0]["status"] == "confirmed"
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='confirm'")[0]["n"] == 1


def test_g1_4_reject_flow(client, fake_llm, db):
    """G1.4 驳回 → rejected + audit reject（无触发词理由不产生误沉淀）"""
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前", assign_mode="self"))
    tid = client.post("/api/simulate_message",
                      json={"sender": "测试同事", "text": MSG}).json()["ai"]["task"]["taskId"]

    r = client.post(f"/api/tasks/{tid}/reject", json={"reason": "信息有误，感谢纠正"})
    assert r.status_code == 200 and r.json()["ok"] is True

    assert db.query("SELECT * FROM task WHERE id=?", (tid,))[0]["status"] == "rejected"
    audits = db.query("SELECT detail FROM audit WHERE action='reject'")
    assert len(audits) == 1
    assert _j.loads(audits[0]["detail"])["reason"] == "信息有误，感谢纠正"
    assert db.query("SELECT COUNT(*) AS n FROM term")[0]["n"] == 0


def test_g1_4b_regex_no_overcapture(client, fake_llm, db):
    """G1.4b【迭代1 修复验证·原缺陷#1】中性驳回理由『这不是任务』不再误提取人名沉淀。
    正则已收紧为显式指人触发词；失败即说明正则过宽回归。"""
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前", assign_mode="self"))
    tid = client.post("/api/simulate_message",
                      json={"sender": "测试同事", "text": MSG}).json()["ai"]["task"]["taskId"]
    client.post(f"/api/tasks/{tid}/reject", json={"reason": "这不是任务"})

    terms = db.query("SELECT term FROM term")
    hit = [t for t in terms if t["term"] == "人称:任务"]
    assert hit == [], "『这不是任务』不应沉淀任何术语；出现说明正则过宽回归"


def test_g1_5_duplicate_delivery_deduped(client, fake_llm, db):
    """G1.5【迭代1 修复验证·原缺陷#3】同消息重放被确定性 msgId 去重拦截（sync 入口）。
    契约：第二次投递返回 dedup=true，不建第二张任务，不重复写 task_created 审计。
    async 模式同语义由 guard_async A4 覆盖（去重判定在 worker）。"""
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前", assign_mode="self"))
    payload = {"sender": "测试同事", "text": MSG}
    r1 = client.post("/api/simulate_message", json=payload).json()
    r2 = client.post("/api/simulate_message", json=payload).json()
    assert r1["ok"] is True and r1["ai"]["action"] == "task_created"
    assert r2["ok"] is True and r2.get("dedup") is True, "重放应被去重拦截"
    n = db.query(
        "SELECT COUNT(*) AS n FROM task WHERE content=? AND creator=? AND status='pending_confirmation'",
        ("出618复盘物料清单", "测试同事"))[0]["n"]
    assert n == 1, f"重放后应只有 1 张任务，实得 {n}"
    created = db.query("SELECT COUNT(*) AS n FROM audit WHERE action='task_created'")[0]["n"]
    assert created == 1, "不应产生第二份 task_created 审计"
