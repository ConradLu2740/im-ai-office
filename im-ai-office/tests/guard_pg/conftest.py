#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Guard·PG 层设施：同一套服务语义，跑在真 Postgres 上（imai_test 库）

后端切换原理：monkeypatch imai.db 的 BACKEND/DATABASE_URL 模块全局，
get_conn 即走 psycopg2 分支；fixture 起止建表/清表，SQLite 分支不受影响。
"""
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]           # im-ai-office/
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv                       # noqa: E402
load_dotenv(ROOT / ".env")

# 后端探测在 import imai.db 时冻结，这里在 import 前清掉 IMAI_DB 并指定 PG
os.environ.pop("IMAI_DB", None)
PG_URL = os.environ.get("IMAI_TEST_PG_URL",
                        "postgresql://imai:imai_secret@127.0.0.1:5432/imai_test")
os.environ["DATABASE_URL"] = PG_URL

import pytest                                        # noqa: E402
from imai import db as imai_db                       # noqa: E402
from imai.services import pipeline                   # noqa: E402


@pytest.fixture(scope="session")
def pg():
    """确保 PG 可达并返回模块句柄。"""
    try:
        con = imai_db.get_conn()
        con.cursor().execute("SELECT 1")
        con.close()
    except Exception as e:
        pytest.skip(f"Postgres 不可达（{e}），guard_pg 跳过")
    return imai_db


@pytest.fixture(autouse=True)
def pg_backend(monkeypatch, pg):
    """强制 db 分派走 PG；每个用例全新种子库。"""
    monkeypatch.setattr(imai_db, "BACKEND", "postgres")
    monkeypatch.setattr(imai_db, "DATABASE_URL", PG_URL)

    def _wipe():
        con = imai_db.get_conn()
        cur = con.cursor()
        for t in ("task", "alias", "person", "audit", "ai_dm", "message",
                  "role", "approval", "term", "grp_meta", "event_dedup"):
            cur.execute(f"DELETE FROM {t}")
        con.commit()
        con.close()
        con = imai_db.init_db()      # PG 分支：建表 + 种子
        con.close()

    _wipe()
    yield
    _wipe()


@pytest.fixture
def fake_llm(monkeypatch):
    routing = {}
    calls = []

    def _fake(system, user, json_mode=True):
        calls.append({"system": system, "user": user})
        for frag, resp in routing.items():
            if frag in user:
                merged = dict(resp)
                merged.setdefault("is_task", True)
                merged.setdefault("confidence", "high")
                merged.setdefault("content", frag)
                merged.setdefault("assignee_hint", None)
                merged.setdefault("deadline_hint", None)
                merged.setdefault("assign_mode", "none")
                return json.dumps(merged, ensure_ascii=False)
        return json.dumps({"is_task": False, "confidence": "low"})

    monkeypatch.setattr(pipeline, "llm_chat", _fake)

    def route(msg_text, **intent_fields):
        routing[msg_text] = intent_fields

    return SimpleNamespace(route=route, calls=calls)


class DBHelper:
    def query(self, sql, params=()):
        con = imai_db.get_conn()
        try:
            c = con.cursor()
            c.execute(sql, params)
            rows = c.fetchall()
            cols = [d[0] for d in c.description] if c.description else []
            return [dict(r) if isinstance(r, dict) else dict(zip(cols, r)) for r in rows]
        finally:
            con.close()

    def exec(self, sql, params=()):
        con = imai_db.get_conn()
        try:
            con.cursor().execute(sql, params)
            con.commit()
        finally:
            con.close()


@pytest.fixture
def db():
    return DBHelper()
