#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G6 · B3 术语库手动增删改（迭代2 Spec §2）：PATCH / DELETE /api/term/{term}"""
import pytest


def test_g6_5_term_update(client, db):
    """改释义后列表更新，溯源 proofs 反映新值"""
    client.post("/api/term/add", json={"term": "红字版", "meaning": "红色修订版"})
    r = client.patch("/api/term/红字版", json={"meaning": "带红色批注的最终版本"})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    terms = client.get("/api/terms").json()["terms"]
    hit = [t for t in terms if t["term"] == "红字版"]
    assert hit and hit[0]["meaning"] == "带红色批注的最终版本"
    # audit 留痕
    rows = db.query("SELECT detail FROM audit WHERE action='term_update'")
    assert any("红字版" in (row["detail"] or "") for row in rows)


def test_g6_6_term_delete(client, db):
    """删除后列表不含，audit 留痕"""
    client.post("/api/term/add", json={"term": "临时词", "meaning": "测试用"})
    r = client.delete("/api/term/临时词")
    assert r.status_code == 200 and r.json()["ok"] is True
    terms = client.get("/api/terms").json()["terms"]
    assert not [t for t in terms if t["term"] == "临时词"]
    rows = db.query("SELECT detail FROM audit WHERE action='term_delete'")
    assert any("临时词" in (row["detail"] or "") for row in rows)


def test_g6_7_term_errors(client, db):
    """改/删不存在的术语 → 404；空 meaning → 400"""
    assert client.patch("/api/term/不存在的词", json={"meaning": "x"}).status_code == 404
    assert client.delete("/api/term/不存在的词").status_code == 404
    client.post("/api/term/add", json={"term": "红字版", "meaning": "红色修订版"})
    assert client.patch("/api/term/红字版", json={"meaning": "  "}).status_code == 400
