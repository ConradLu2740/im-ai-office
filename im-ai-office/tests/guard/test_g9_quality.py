#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G9 · 识别质量统计（sync 路径 ai_processed 审计 + quality_report 服务 + 端点）

Spec: docs/specs/识别质量统计Spec.md · Plan: docs/plans/2026-08-31-quality-stats.md
"""
import json

from tests.helpers import make_intent


def _d(row):
    """audit.detail 是 JSON 字符串 → dict"""
    return json.loads(row["detail"]) if isinstance(row["detail"], str) else row["detail"]

MSG = "这次618复盘我来出物料清单，下周三前"


def _route(client, fake_llm):
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前",
                                      assign_mode="self"))


# ---------- Task 1: sync 路径补 ai_processed ----------

def test_g9_1_simulate_sync_audits(client, fake_llm, db):
    """simulate_message sync 分支产生 ai_processed（source=simulate，含 latency）"""
    _route(client, fake_llm)
    r = client.post("/api/simulate_message", json={"sender": "测试同事", "text": MSG})
    assert r.status_code == 200
    tid = r.json()["ai"]["task"]["taskId"]
    rows = db.query("SELECT actor, action, detail FROM audit WHERE action='ai_processed'")
    assert len(rows) == 1
    d = _d(rows[0])
    assert rows[0]["actor"] == "api"
    assert d["action"] == "task_created"
    assert d["taskId"] == tid
    assert d["source"] == "simulate"
    assert isinstance(d["latency_ms"], int) and d["latency_ms"] >= 0


def test_g9_2_sdk_message_sync_audits(client, fake_llm, db):
    """sdk_message sync 分支产生 ai_processed（source=sdk_message）"""
    _route(client, fake_llm)
    r = client.post("/api/sdk_message",
                    json={"sender": "测试同事", "text": MSG, "conv_id": "sg_sdk"})
    assert r.status_code == 200 and r.json()["ok"] is True
    rows = db.query("SELECT detail FROM audit WHERE action='ai_processed'")
    assert len(rows) == 1
    d = _d(rows[0])
    assert d["action"] == "task_created"
    assert d["source"] == "sdk_message"
    assert d["content"] == MSG[:60]


def test_g9_3_chat_audits_with_source(client, fake_llm, db):
    """chat 端点产生 ai_processed（source=chat，msgId 可为空）"""
    _route(client, fake_llm)
    r = client.post("/api/chat", json={"message": MSG})
    assert r.status_code == 200
    rows = db.query("SELECT detail FROM audit WHERE action='ai_processed'")
    assert len(rows) == 1
    d = _d(rows[0])
    assert d["action"] == "task_created"
    assert d["source"] == "chat"
    assert "latency_ms" in d


def test_g9_4_dedup_skip_no_audit(client, fake_llm, db):
    """确定性去重命中的重放不产生 ai_processed（只记第一次）"""
    _route(client, fake_llm)
    body = {"sender": "测试同事", "text": MSG}
    assert client.post("/api/simulate_message", json=body).json()["ok"] is True
    second = client.post("/api/simulate_message", json=body).json()
    assert second.get("dedup") is True
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='ai_processed'")[0]["n"] == 1
