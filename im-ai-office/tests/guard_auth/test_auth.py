#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Guard·auth：认证加固行为（deps 的 env 运行时读取，monkeypatch.setenv 即生效）"""
from tests.helpers import make_intent

MSG_SELF = "618复盘物料清单我来出，周五前"


def test_role_set_requires_admin_token(client, monkeypatch):
    """A1 管理令牌启用后：无令牌提权被拒，带令牌成功"""
    monkeypatch.setenv("IMAI_ADMIN_TOKEN", "sekrit-admin")
    denied = client.post("/api/role/set",
                         json={"oim_user_id": "user001", "role": "group_admin"}).json()
    assert denied["ok"] is False and "admin token" in denied["error"]
    ok = client.post("/api/role/set", json={"oim_user_id": "user001", "role": "group_admin"},
                     headers={"X-IMAI-Admin-Token": "sekrit-admin"}).json()
    assert ok["ok"] is True and ok["role"] == "group_admin"


def test_approval_decide_requires_admin_token(client, monkeypatch):
    """A2 审批决定同样受管理令牌保护"""
    monkeypatch.setenv("IMAI_ADMIN_TOKEN", "sekrit-admin")
    r = client.post("/api/approvals/1/decide", json={"approved": True}).json()
    assert r["ok"] is False and "admin token" in r["error"]


def test_login_password_gate(client, monkeypatch):
    """A3 登录口令：缺/错被拒，正确才放行换 token"""
    monkeypatch.setenv("IMAI_LOGIN_PASSWORD", "team-pass-123")
    no_pw = client.post("/openim/login", json={"user_id": "user001"}).json()
    assert no_pw["ok"] is False and "password" in no_pw["error"]
    bad = client.post("/openim/login",
                      json={"user_id": "user001", "password": "wrong"}).json()
    assert bad["ok"] is False
    # 口令正确才会真正调 OpenIM 换 token（沙箱内 OpenIM 不可达 → 报连接类错误而非口令错误）
    good = client.post("/openim/login",
                       json={"user_id": "user001", "password": "team-pass-123"}).json()
    assert "password" not in (good.get("error") or "")


def test_callback_token_gate_sync(client, monkeypatch, fake_llm):
    """A4 回调令牌启用后：无令牌 403，带令牌进入处理（sync 分支探针）"""
    monkeypatch.setenv("AUTH_TOKEN", "cb-token-1")
    fake_llm.route(MSG_SELF, **make_intent(is_task=False))
    denied = client.post("/callback", json={
        "msgID": "auth-cb-1", "groupID": "sg_a", "sendID": "u1",
        "senderNickname": "李娜(娜姐)", "contentType": "101", "content": MSG_SELF,
    }).json()
    assert denied["ok"] is False and "token" in denied["error"]
    ok = client.post("/callback", headers={"X-IMAI-Token": "cb-token-1"}, json={
        "msgID": "auth-cb-2", "groupID": "sg_a", "sendID": "u1",
        "senderNickname": "李娜(娜姐)", "contentType": "101", "content": MSG_SELF,
    }).json()
    assert ok["ok"] is True


def test_allowed_origins_parsing(monkeypatch):
    """A5 CORS 白名单解析：显式配置优先，默认集合含桌面源"""
    from imai.api import deps
    monkeypatch.delenv("IMAI_ALLOWED_ORIGINS", raising=False)
    defaults = deps.allowed_origins()
    assert "tauri://localhost" in defaults and "https://tauri.localhost" in defaults
    monkeypatch.setenv("IMAI_ALLOWED_ORIGINS", "https://a.internal, https://b.internal")
    assert deps.allowed_origins() == ["https://a.internal", "https://b.internal"]


def test_compat_when_unset(client, monkeypatch):
    """A6 兼容铁律：三个 env 全未设置时，旧行为完全保留（提权/受理不受拦）。

    认证放行语义由 role/set 证明；不投递消息（避免未 mock 的真 LLM 依赖）。"""
    for k in ("IMAI_ADMIN_TOKEN", "IMAI_LOGIN_PASSWORD", "AUTH_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    assert client.post("/api/role/set",
                       json={"oim_user_id": "user001", "role": "group_admin"}).json()["ok"] is True
    d = client.post("/api/simulate_message", json={"sender": "李娜(娜姐)", "text": ""}).json()
    assert d["ok"] is False and "text" in d["error"]   # 入口活着且参数校验照常
