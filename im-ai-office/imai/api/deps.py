#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Step4 · 认证依赖：管理令牌 / 登录口令 / 回调鉴权 / CORS 白名单

兼容铁律：相关 env 未设置时保持旧行为（放行 + 一次性 WARN），
设置即强制——升级不锁死，配置即加固。
"""
import os
import threading

_warned = set()


def _warn_once(key, message):
    if key not in _warned:
        with threading.Lock():
            if key not in _warned:
                _warned.add(key)
                print(f"[auth] WARN {message}")


def admin_token_required():
    """env 是否启用了管理令牌强制。"""
    return bool(os.environ.get("IMAI_ADMIN_TOKEN"))


def check_admin(request):
    """校验 X-IMAI-Admin-Token。返回 None=通过；否则错误 dict（供路由直接返回）。"""
    expected = os.environ.get("IMAI_ADMIN_TOKEN", "")
    if not expected:
        _warn_once("admin", "IMAI_ADMIN_TOKEN 未设置，管理端点处于无鉴权模式（内网自用默认）")
        return None
    if request.headers.get("X-IMAI-Admin-Token") == expected:
        return None
    return {"ok": False, "error": "admin token required"}


def check_login_password(body):
    """校验登录口令。返回 None=通过；否则错误 dict。"""
    expected = os.environ.get("IMAI_LOGIN_PASSWORD", "")
    if not expected:
        _warn_once("login", "IMAI_LOGIN_PASSWORD 未设置，登录无口令校验（内网自用默认）")
        return None
    if (body or {}).get("password") == expected:
        return None
    return {"ok": False, "error": "password required"}


def check_callback_token(request):
    """校验回调令牌（复用 AUTH_TOKEN env）。返回 None=通过；否则错误 dict。"""
    expected = os.environ.get("AUTH_TOKEN", "")
    if not expected:
        _warn_once("callback", "AUTH_TOKEN 未设置，回调不校验令牌（内网自用默认）")
        return None
    if request.headers.get("X-IMAI-Token") == expected:
        return None
    return {"ok": False, "error": "callback token required"}


def allowed_origins():
    """CORS 白名单解析；未配置时给出默认集合。"""
    raw = os.environ.get("IMAI_ALLOWED_ORIGINS", "")
    if raw.strip():
        return [o.strip() for o in raw.split(",") if o.strip()]
    return ["tauri://localhost", "https://tauri.localhost",
            "http://localhost:1420", "http://127.0.0.1:8000",
            "http://localhost:8000"]
