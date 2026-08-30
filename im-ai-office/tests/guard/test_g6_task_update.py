#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G6 · 任务可修改（迭代2 Spec B1）：改负责人 / 改期重置提醒 / 取消 / 错误分支"""
from tests.helpers import make_intent

MSG = "这次618复盘我来出物料清单，下周三前"


def _create_confirmed(client, fake_llm):
    """建任务并确认，返回 task_id。"""
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前", assign_mode="self"))
    created = client.post("/api/simulate_message", json={"sender": "测试同事", "text": MSG}).json()
    tid = created["ai"]["task"]["taskId"]
    r = client.post(f"/api/tasks/{tid}/confirm", json={})
    assert r.status_code == 200 and r.json()["ok"] is True
    return tid


def test_g6_1_update_assignee_and_deadline(client, fake_llm, db):
    """G6.1 已确认任务可改负责人与截止时间，deadline_at 同步，audit 留痕"""
    tid = _create_confirmed(client, fake_llm)
    r = client.patch(f"/api/tasks/{tid}", json={"assignee": "李娜(娜姐)",
                                                "deadline": "2026-09-05 18:00"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is True
    t = d["task"]
    assert t["assignee"] == "李娜(娜姐)"
    assert t["deadline"] == "2026-09-05 18:00"
    assert str(t["deadline_at"])[:16] == "2026-09-05 18:00"
    assert t["status"] == "confirmed"
    # audit：每个字段一条 task_update + 一条 reminder_reset
    n_update = db.query("SELECT COUNT(*) AS n FROM audit WHERE action='task_update'")[0]["n"]
    assert n_update == 2
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='reminder_reset'")[0]["n"] == 1
    # detail 里记录 old→new
    rows = db.query("SELECT detail FROM audit WHERE action='task_update' AND detail LIKE '%assignee%'")
    assert "李娜" in rows[0]["detail"]


def test_g6_2_deadline_change_resets_reminders(client, fake_llm, db):
    """G6.2 改期后 reminder_sent 清空，三档提醒按新时间重新起算"""
    tid = _create_confirmed(client, fake_llm)
    db.exec("INSERT INTO reminder_sent(task_id, tier) VALUES(?,?), (?,?), (?,?)",
            (tid, "due_24h", tid, "due_day", tid, "overdue"))
    assert db.query("SELECT COUNT(*) AS n FROM reminder_sent WHERE task_id=?", (tid,))[0]["n"] == 3
    r = client.patch(f"/api/tasks/{tid}", json={"deadline": "2026-09-10 09:30"})
    assert r.status_code == 200
    assert db.query("SELECT COUNT(*) AS n FROM reminder_sent WHERE task_id=?", (tid,))[0]["n"] == 0


def test_g6_3_cancel_task(client, fake_llm, db):
    """G6.3 取消 → status='cancelled'，看板列表不再返回，audit 留痕"""
    tid = _create_confirmed(client, fake_llm)
    r = client.patch(f"/api/tasks/{tid}", json={"action": "cancel"})
    assert r.status_code == 200
    assert r.json()["task"]["status"] == "cancelled"
    tasks = client.get("/api/tasks").json()["tasks"]
    assert all(t["id"] != tid for t in tasks)
    rows = db.query("SELECT detail FROM audit WHERE action='task_update' AND detail LIKE '%cancelled%'")
    assert len(rows) == 1


def test_g6_4_error_branches(client, fake_llm, db):
    """G6.4 404 不存在 / 400 deadline 非法 / 400 空变更 / 400 非法 action"""
    tid = _create_confirmed(client, fake_llm)
    assert client.patch("/api/tasks/999999", json={"assignee": "张伟"}).status_code == 404
    assert client.patch(f"/api/tasks/{tid}", json={"deadline": "abc"}).status_code == 400
    assert client.patch(f"/api/tasks/{tid}", json={}).status_code == 400
    assert client.patch(f"/api/tasks/{tid}", json={"action": "delete"}).status_code == 400
    # 无效请求不改状态
    assert client.get("/api/tasks").json()["tasks"][0]["status"] == "confirmed"
