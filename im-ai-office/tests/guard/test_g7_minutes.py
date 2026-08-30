#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G7 · B2 会议纪要（迭代2 Spec §3）：生成/列表/详情/转任务/错误分支"""
from tests.helpers import make_intent
from imai.repos import message_add

CONV = "sg_meeting"
LLM_MINUTES = {
    "title": "618 复盘会",
    "summary": "对齐了复盘分工与上线节奏",
    "decisions": ["复盘会改为线上进行"],
    "action_items": [
        {"content": "出618复盘PPT", "assignee_hint": "我", "deadline_hint": "周五前"},
    ],
}


def _seed_messages(db):
    db.exec("INSERT INTO message(conv_id, sender_id, sender_name, content) VALUES(?,?,?,?)",
            (CONV, "u1", "张伟", "明天下午3点开618复盘会"))
    db.exec("INSERT INTO message(conv_id, sender_id, sender_name, content) VALUES(?,?,?,?)",
            (CONV, "u2", "李娜", "好，我把数据先拉出来"))
    db.exec("INSERT INTO message(conv_id, sender_id, sender_name, content) VALUES(?,?,?,?)",
            (CONV, "u1", "张伟", "出复盘PPT 这件事谁跟一下"))


def test_g7_1_generate_and_fetch(client, fake_llm, db):
    """生成纪要 → 落库 → 列表/详情可查，结构完整"""
    _seed_messages(db)
    fake_llm.route("张伟", **LLM_MINUTES)  # transcript 含发送者名，按包含匹配
    r = client.post("/api/minutes/generate", json={"conv_id": CONV, "limit": 50})
    assert r.status_code == 200, r.text
    m = r.json()["minutes"]
    assert m["title"] == "618 复盘会"
    assert m["decisions"] == ["复盘会改为线上进行"]
    assert m["action_items"][0]["content"] == "出618复盘PPT"
    assert m["msg_count"] == 3
    # 列表
    lst = client.get("/api/minutes", params={"conv_id": CONV}).json()["minutes"]
    assert any(x["id"] == m["id"] for x in lst)
    # 详情
    detail = client.get(f"/api/minutes/{m['id']}").json()["minutes"]
    assert detail["summary"] == m["summary"]
    # audit
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='minutes_generated'")[0]["n"] == 1


def test_g7_2_action_item_to_task(client, fake_llm, db):
    """行动项转任务 → pending_confirmation 进看板正常确认流"""
    _seed_messages(db)
    fake_llm.route("张伟", **LLM_MINUTES)
    mid = client.post("/api/minutes/generate", json={"conv_id": CONV}).json()["minutes"]["id"]
    r = client.post(f"/api/minutes/{mid}/task", json={"index": 0})
    assert r.status_code == 200, r.text
    tid = r.json()["taskId"]
    tasks = client.get("/api/tasks").json()["tasks"]
    row = [t for t in tasks if t["id"] == tid]
    assert row and row[0]["status"] == "pending_confirmation"
    assert "出618复盘PPT" in row[0]["content"]
    assert row[0]["creator"] == f"minutes#{mid}"
    # 转出来的任务能走确认流
    assert client.post(f"/api/tasks/{tid}/confirm", json={}).json()["ok"] is True


def test_g7_3_error_branches(client, fake_llm, db):
    """空会话 400 / index 越界 400 / 不存在 404"""
    assert client.post("/api/minutes/generate",
                       json={"conv_id": "sg_empty"}).status_code == 400
    _seed_messages(db)
    fake_llm.route("张伟", **LLM_MINUTES)
    mid = client.post("/api/minutes/generate", json={"conv_id": CONV}).json()["minutes"]["id"]
    assert client.post(f"/api/minutes/{mid}/task", json={"index": 9}).status_code == 400
    assert client.get("/api/minutes/999999").status_code == 404
