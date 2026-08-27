#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Guard·async 层测试设施

隔离策略：
- 真 Redis 专用 db=15，起止 FLUSHDB
- AI 判定走 fake_llm（与 Guard sync 同思路）：队列/SSE/dedup/worker 全真，模型输出固定
  —— 质量评估归 tests/eval，本层只守「异步链路结构契约」
- 本目录同名 fixture 覆盖根 conftest 的 autouse fresh_db，避免双重清理
"""
import json
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]           # im-ai-office/
sys.path.insert(0, str(ROOT))

_TMP_DB_DIR = Path("/tmp/imai_guard_pytest")
_TMP_DB_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("IMAI_DB", str(_TMP_DB_DIR / "guard.db"))
os.environ["IMAI_REDIS_URL"] = os.environ.get("IMAI_TEST_REDIS_URL",
                                              "redis://127.0.0.1:6379/15")

import pytest                                        # noqa: E402
from fastapi.testclient import TestClient            # noqa: E402

from imai import config                              # noqa: E402
from imai.db import get_conn as _get_conn            # noqa: E402
from imai.db import init_db as _init_db              # noqa: E402
from imai.services import bus                        # noqa: E402
from imai.services import pipeline                   # noqa: E402

REDIS_DB = 15


@pytest.fixture(scope="session")
def async_client():
    """async 模式 TestClient：db15 Redis + OpenIM 发送 stub + startup 起 worker 线程。"""
    r = bus.make_redis_client(db=REDIS_DB)
    r.flushdb()

    import app as app_module
    from imai.integrations import openim_client as oim_client_mod

    sent_group, sent_private = [], []
    oim_client_mod.send_group_notice = lambda gid, text: (
        sent_group.append({"group_id": gid, "text": text}) or {"errCode": 0})
    oim_client_mod.send_private_confirm = lambda gid, uid, text: (
        sent_private.append({"group_id": gid, "user_id": uid, "text": text}) or {"errCode": 0})

    saved_mode, saved_url = config.AI_MODE, config.REDIS_URL
    config.AI_MODE = "async"
    config.REDIS_URL = f"redis://127.0.0.1:6379/{REDIS_DB}"

    with TestClient(app_module.app) as c:
        c.openim_sends = {"sent_group": sent_group, "sent_private": sent_private}
        yield c

    config.AI_MODE = saved_mode
    config.REDIS_URL = saved_url
    r.flushdb()


ALL_TABLES = ("task", "alias", "person", "audit", "ai_dm", "message",
              "role", "approval", "term", "grp_meta", "event_dedup")


@pytest.fixture(autouse=True)
def fresh_db():
    """覆盖根 conftest 的同名词：async 目录统一由此管理库与流。"""
    def _wipe():
        con = _get_conn()
        c = con.cursor()
        for t in ALL_TABLES:
            c.execute(f"DELETE FROM {t}")
        con.commit()
        con.close()
        con = _init_db()          # 补种子
        con.close()

    _wipe()
    bus.make_redis_client(db=REDIS_DB).flushdb()
    yield
    _wipe()


@pytest.fixture(autouse=True)
def fake_llm(monkeypatch):
    """异步链路的固定 LLM 输出（autouse：避免用例间隙漏网消息打真 LLM 卡住 worker）。"""
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


# ---------- 断言辅助 ----------

def wait_task(client, contains, timeout=8.0):
    """轮询任务列表直至出现含指定文本的任务（worker 异步生效等待桥）。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        tasks = client.get("/api/tasks").json().get("tasks", [])
        hit = [t for t in tasks if contains in (t.get("content") or "")]
        if hit:
            return hit[0]
        time.sleep(0.25)
    return None


def client_audits(limit=200):
    from imai.repos import audit_recent
    con = _get_conn()
    try:
        return audit_recent(con, limit)
    finally:
        con.close()


def wait_audit(action, contains=None, timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = client_audits()
        hit = [a for a in rows if a["action"] == action and
               (contains is None or contains in (a.get("detail") or ""))]
        if hit:
            return hit[0]
        time.sleep(0.25)
    return None
