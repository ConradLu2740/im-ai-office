#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IMAI · Guard 回归测试共享设施（《回归加固Spec.md》§3）

隔离策略：
- IMAI_DB 指向 /tmp/imai_guard_pytest/guard.db（import core 之前设置，绝不碰 imai.db 主库）
- fake_llm 按消息文本路由固定 intent JSON：消除模型抖动，重构期输出必须逐字段一致
- OpenIM HTTP 层（send_group_notice / send_private_confirm）统一 stub 为内存收集器
- startup 网关副作用：_gateway_auto_login 为 daemon 线程且全兜底（侦察结论#1），无需处理
"""
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent          # im-ai-office/
sys.path.insert(0, str(ROOT))

# 必须在 import imai（进而冻结 LLM_*/DB_FILE 常量）之前注入 .env；
# 生产路径由 app.py 首行 load_dotenv 完成，Eval 层直连真实 LLM 依赖此处时序。
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

_TMP_DB_DIR = Path("/tmp/imai_guard_pytest")
_TMP_DB_DIR.mkdir(parents=True, exist_ok=True)
os.environ["IMAI_DB"] = str(_TMP_DB_DIR / "guard.db")

import pytest                                    # noqa: E402
from fastapi.testclient import TestClient        # noqa: E402

from imai.integrations import openim_client as oim_client_mod   # noqa: E402
from imai.services import pipeline                     # noqa: E402
from imai.config import EVENTS                         # noqa: E402
from imai.db import get_conn as _get_conn              # noqa: E402
from imai.db import init_db as _init_db                # noqa: E402
import app as app_module                               # noqa: E402

# 业务回归测试剥离认证开关（Step4）——必须在上述所有 load_dotenv/import app 之后，
# 否则 app.py 的二次 load_dotenv 会把已 pop 的键重新注入；
# 认证行为由 tests/guard_auth 专门场景化验证。
for _auth_key in ("AUTH_TOKEN", "IMAI_ADMIN_TOKEN", "IMAI_LOGIN_PASSWORD"):
    os.environ.pop(_auth_key, None)
import app as app_module                               # noqa: E402

ALL_TABLES = ("task", "alias", "person", "audit", "ai_dm", "message",
              "role", "approval", "term", "grp_meta")


def wipe_and_seed():
    """清空业务表并恢复 init_db 种子（张伟/张敏/李娜 + 别名）。"""
    con = _get_conn()
    c = con.cursor()
    for t in ALL_TABLES:
        c.execute(f"DELETE FROM {t}")
    con.commit()
    con.close()
    EVENTS.clear()
    con = _init_db()          # person 为空 → 自动补种子
    con.close()


@pytest.fixture(scope="session")
def client():
    """FastAPI TestClient；OpenIM 发送函数 stub 掉（Guard 层不测网络）。"""
    sent_group, sent_private = [], []

    def _fake_notice(group_id, text):
        sent_group.append({"group_id": group_id, "text": text})
        return {"errCode": 0}

    def _fake_private(group_id, user_id, text):
        sent_private.append({"group_id": group_id, "user_id": user_id, "text": text})
        return {"errCode": 0}

    oim_client_mod.send_group_notice = _fake_notice
    oim_client_mod.send_private_confirm = _fake_private
    holder = SimpleNamespace(sent_group=sent_group, sent_private=sent_private)
    with TestClient(app_module.app) as c:
        c.openim_sends = holder
        yield c


@pytest.fixture(autouse=True)
def fresh_db():
    """每个用例：全新种子库。"""
    wipe_and_seed()
    yield
    wipe_and_seed()


@pytest.fixture
def fake_llm(monkeypatch):
    """按『user 文本包含路由键』返回预设 intent JSON；截获全部 (system,user) 供注入断言。"""
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
        con = _get_conn()
        try:
            c = con.cursor()
            c.execute(sql, params)
            cols = [d[0] for d in c.description]
            return [dict(zip(cols, r)) for r in c.fetchall()]
        finally:
            con.close()

    def exec(self, sql, params=()):
        con = _get_conn()
        try:
            con.execute(sql, params)
            con.commit()
        finally:
            con.close()


@pytest.fixture
def db():
    return DBHelper()
