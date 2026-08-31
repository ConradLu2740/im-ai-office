#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Guard·PG：quality_report 跑在真 Postgres 上（代码 schema：ts + TEXT detail）"""
import json
from tests.helpers import make_intent

MSG = "这次618复盘我来出物料清单，下周三前"


def test_pg_quality_report_and_endpoint(pg_backend, client, fake_llm, db, monkeypatch):
    """PG 上统计服务与端点语义与 SQLite 一致"""
    # guard_async 的 session 级 client 会把 AI_MODE=async 保留到 session 末尾，
    # 本测试需要 sync 直处理路径，显式固定（跨 conftest 全局状态防御）
    from imai import config as _cfg
    monkeypatch.setattr(_cfg, "AI_MODE", "sync")
    fake_llm.route(MSG, **make_intent("出618复盘物料清单",
                                      assignee_hint="我", deadline_hint="下周三前",
                                      assign_mode="self"))
    created = client.post("/api/sdk_message",
                          json={"sender": "测试同事", "text": MSG, "conv_id": "sg_pg"}).json()
    print("RESP_BODY:", json.dumps(created, ensure_ascii=False)[:300])
    tid = created["ai"]["task"]["taskId"]
    client.post(f"/api/tasks/{tid}/confirm", json={})
    client.post(f"/api/tasks/{tid}/reject", json={"reason": "pg 驳回样例"})

    r = client.get("/api/stats/quality?days=1").json()
    assert r["ok"] is True
    assert r["totals"]["processed"] >= 1       # sync 路径审计已落 PG
    assert r["totals"]["confirm"] >= 1 and r["totals"]["reject"] >= 1
    assert r["one_pass_rate"] is not None
    assert any(x["reason"] == "pg 驳回样例" for x in r["reject_reasons"])
    assert r["latency"]["n"] >= 1 and r["latency"]["p50_ms"] is not None
