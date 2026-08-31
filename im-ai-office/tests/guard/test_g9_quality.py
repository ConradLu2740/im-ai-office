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


# ---------- Task 2: quality_report 统计服务 ----------

def _seed_quality(db):
    """窗口内：4 confirm(3 high+1 medium) + 1 reject(带 reason, high) + 1 歧义 +
    2 条 ai_processed(100/300ms) + 1 dedup + 1 挂起任务(3天前) + 1 条窗口外记录"""
    def task(status, confidence, updated=None):
        db.exec("INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg,"
                "created_at,updated_at) VALUES('内容','发','接','周五',?,?,'src',"
                "COALESCE(?,datetime('now')),COALESCE(?,datetime('now')))",
                (status, confidence, updated, updated))

    def audit(action, detail, ts=None):
        db.exec("INSERT INTO audit(actor,action,detail,ts) VALUES('api',?,?,"  # noqa: SLF001
                "COALESCE(?,datetime('now')))", (action, detail, ts))

    for _ in range(3):
        task("confirmed", "high")
    task("confirmed", "medium")
    task("rejected", "high")
    # 挂起任务：原生 SQL 求值时间表达式（参数绑定会存字面量，见下方 audit 注释）
    db.exec("INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg,"
            "created_at,updated_at) VALUES('内容','发','接','周五','pending_confirmation','high',"
            "'src',datetime('now'),datetime('now','-3 days'))")
    audit("task_created", '{"taskId":1}', None)
    audit("confirm", '{"taskId":1}', None)
    audit("confirm", '{"taskId":2}', None)
    audit("confirm", '{"taskId":3}', None)
    audit("confirm", '{"taskId":4}', None)
    audit("reject", '{"taskId":5,"reason":"不该建"}', None)
    audit("identify_ambiguous", '{"taskId":9,"candidates":["小张1","小张2"]}', None)
    audit("ai_processed", '{"latency_ms":100,"action":"task_created"}', None)
    audit("ai_processed", '{"latency_ms":300,"action":"ignore"}', None)
    audit("ai_dedup_skip", '{"msgId":"m1"}', None)
    # 窗口外记录：直接原生 SQL 让 SQLite 求值时间表达式（参数绑定会存字面量）
    db.exec('INSERT INTO audit(actor,action,detail,ts) VALUES'
            "('api','ai_processed','{\"latency_ms\":999,\"action\":\"task_created\"}',"
            "datetime('now','-10 days'))")


def test_g9_5_quality_report_numbers(client, db):
    """核心数字：通过率 0.75 / 驳回原因 / 挂起 / 延迟分位 / 窗口过滤"""
    from imai.db import get_conn
    from imai.services.stats import quality_report
    _seed_quality(db)
    con = get_conn()
    r = quality_report(con, days=7)
    con.close()
    assert r["totals"]["processed"] == 2          # 窗口外那条不计
    assert r["totals"]["confirm"] == 4 and r["totals"]["reject"] == 1
    assert r["totals"]["ambiguous"] == 1
    assert r["totals"]["dedup_skipped"] == 1
    assert r["one_pass_rate"] == 0.8  # 4 confirm / (4+1) reject，含 medium 用例
    assert r["reject_reasons"] == [{"reason": "不该建", "n": 1}]
    conf = {c["confidence"]: c for c in r["confidence"]}
    # 置信度校准为全量累计（含挂起任务）：high=3确认+1驳回+1挂起
    assert conf["high"]["created"] == 5 and conf["high"]["confirm"] == 3 and conf["high"]["reject"] == 1
    assert conf["medium"]["created"] == 1 and conf["medium"]["confirm"] == 1
    assert r["latency"]["n"] == 2
    assert r["latency"]["p50_ms"] == 100 and r["latency"]["p95_ms"] == 300
    stale = r["pending_stale"]
    assert len(stale) == 1 and stale[0]["status"] == "pending_confirmation"
    assert stale[0]["age_hours"] > 48


def test_g9_6_quality_report_empty(client, db):
    """空窗口：全 0、除零安全、one_pass_rate=None"""
    from imai.services.stats import quality_report
    from imai.db import get_conn
    con = get_conn()
    r = quality_report(con, days=7)
    con.close()
    assert r["totals"]["processed"] == 0
    assert r["one_pass_rate"] is None
    assert r["reject_reasons"] == []
    assert r["latency"]["n"] == 0 and r["latency"]["p50_ms"] is None
    assert r["pending_stale"] == []


# ---------- Task 3: GET /api/stats/quality 端点 ----------

def test_g9_7_stats_endpoint(client, db):
    """端点透传 quality_report；days 缺省 7"""
    _seed_quality(db)
    r = client.get("/api/stats/quality")
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] is True and d["window_days"] == 7
    assert d["totals"]["confirm"] == 4
    assert d["one_pass_rate"] == 0.8
    r2 = client.get("/api/stats/quality", params={"days": 30})
    assert r2.json()["window_days"] == 30


def test_g9_8_stats_endpoint_bad_days(client):
    """days 非法 → 400"""
    for bad in (0, -1, 366):
        r = client.get("/api/stats/quality", params={"days": bad})
        assert r.status_code == 400, f"days={bad} 应 400"
    r = client.get("/api/stats/quality", params={"days": "abc"})
    assert r.status_code == 422  # FastAPI 类型校验


def test_g9_9_detail_dict_compat():
    """audit.detail 双类型：PG JSONB 读出即 dict，TEXT 为 JSON 字符串（生产旧库踩坑）"""
    from imai.services.stats import _loads
    assert _loads('{"latency_ms":100}') == {"latency_ms": 100}
    assert _loads({"latency_ms": 100}) == {"latency_ms": 100}   # JSONB dict
    assert _loads(None) == {}
    assert _loads("not-json") == {}
