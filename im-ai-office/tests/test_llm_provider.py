#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LLM Provider 重试逻辑单测（迭代 2 · R2）

Spec：部署收尾与LLM重试Spec.md §R2 验收清单。
注入点：monkeypatch llm_provider._post / _sleep / LLM_RETRIES（见模块 docstring）。
注意：root conftest 的 fake_llm patch 的是 pipeline.llm_chat 绑定，与本模块无关。
"""
import json
import urllib.error

import pytest

from imai.integrations import llm_provider

N_RETRIES = 2  # 固定重试次数，断言确定化


@pytest.fixture(autouse=True)
def _deterministic(monkeypatch):
    """退避置零 + 固定重试次数，保证用例快且断言确定。"""
    monkeypatch.setattr(llm_provider, "_sleep", lambda *_: None)
    monkeypatch.setattr(llm_provider, "LLM_RETRIES", N_RETRIES)


def _ok(content="ok"):
    return {"choices": [{"message": {"content": content}}]}


def _http_error(code):
    return urllib.error.HTTPError(url="http://llm.test", code=code, msg="e", hdrs=None, fp=None)


def _install(monkeypatch, responses):
    """按序注入 _post 响应/异常，返回调用次数容器。"""
    seq = list(responses)
    calls = []
    def fake_post(payload):
        calls.append(payload)
        item = seq.pop(0) if seq else None
        if isinstance(item, Exception):
            raise item
        return item if item is not None else _ok("fallback")
    monkeypatch.setattr(llm_provider, "_post", fake_post)
    return calls


def test_empty_response_then_success(monkeypatch):
    """空 content → 重试 → 第二次成功返回正常内容。"""
    calls = _install(monkeypatch, [_ok(""), _ok("hello")])
    assert llm_provider.llm_chat("sys", "user") == "hello"
    assert len(calls) == 2


def test_urlerror_then_success(monkeypatch):
    """瞬时网络错误 → 重试成功。"""
    calls = _install(monkeypatch, [urllib.error.URLError("boom"), _ok("ok")])
    assert llm_provider.llm_chat("sys", "user") == "ok"
    assert len(calls) == 2


def test_429_then_success(monkeypatch):
    """限流 429 → 重试成功。"""
    calls = _install(monkeypatch, [_http_error(429), _ok("ok")])
    assert llm_provider.llm_chat("sys", "user") == "ok"
    assert len(calls) == 2


def test_401_no_retry(monkeypatch):
    """认证失败 401：不重试立即抛（调用次数=1）。"""
    calls = _install(monkeypatch, [_http_error(401)])
    with pytest.raises(urllib.error.HTTPError):
        llm_provider.llm_chat("sys", "user")
    assert len(calls) == 1


def test_retries_exhausted_raises(monkeypatch):
    """持续 URLError：耗尽 1+N 次后抛最后一个异常。"""
    calls = _install(monkeypatch, [urllib.error.URLError(f"e{i}") for i in range(N_RETRIES + 2)])
    with pytest.raises(urllib.error.URLError):
        llm_provider.llm_chat("sys", "user")
    assert len(calls) == 1 + N_RETRIES


def test_empty_response_exhausted_raises(monkeypatch):
    """持续空响应：耗尽后抛 RuntimeError，由上层 intent_detect 兜底承接。"""
    calls = _install(monkeypatch, [_ok(""), _ok(""), _ok("")])
    with pytest.raises(RuntimeError, match="空响应"):
        llm_provider.llm_chat("sys", "user")
    assert len(calls) == 1 + N_RETRIES


def test_bad_json_body_retried(monkeypatch):
    """HTTP 200 但响应体非法 JSON：可重试路径。"""
    calls = _install(monkeypatch, ["not-json{{", _ok("ok")])
    assert llm_provider.llm_chat("sys", "user") == "ok"
    assert len(calls) == 2


def test_json_mode_payload_flag(monkeypatch):
    """json_mode=True 时请求带 response_format（行为保持迁移前一致）。"""
    captured = {}
    def fake_post(payload):
        captured.update(payload)
        return _ok("{}")
    monkeypatch.setattr(llm_provider, "_post", fake_post)
    llm_provider.llm_chat("sys", "user", json_mode=True)
    assert captured["response_format"] == {"type": "json_object"}
