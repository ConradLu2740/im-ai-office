#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G8 · LLM 锚点契约（DX Spec D3）：任何服务不得绕过 imai/llm.py 直连 provider"""
import pytest

from imai import llm


def _boom(*args, **kwargs):
    raise RuntimeError("bypassed LLM anchor: 服务绕过了 imai/llm.py 直连 provider")


def test_g8_1_pipeline_routes_through_anchor(monkeypatch):
    """pipeline 的 LLM 调用必须走锚点：断开锚点后 intent_detect 应立即报错"""
    monkeypatch.setattr(llm, "_impl", _boom)
    from imai.services import pipeline
    with pytest.raises(RuntimeError, match="bypassed LLM anchor"):
        pipeline.intent_detect("任意文本")


def test_g8_2_minutes_routes_through_anchor(monkeypatch, db):
    """minutes 的 LLM 调用必须走锚点"""
    monkeypatch.setattr(llm, "_impl", _boom)
    from imai.db import get_conn
    from imai.repos import message_add
    from imai.services import minutes as M
    con = get_conn()
    try:
        message_add(con, "sg_anchor", "u1", "张伟", "锚点检查消息")
        with pytest.raises(RuntimeError, match="bypassed LLM anchor"):
            M.generate_minutes(con, "sg_anchor", 10)
    finally:
        con.close()
