#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LLM 调用唯一锚点（DX Spec D3）

背景：测试的 fake_llm 靠 monkeypatch 替换 LLM 函数。历史上锚点是
`pipeline.llm_chat`——这是隐性约定，新服务若直接 import
`integrations.llm_provider.llm_chat` 会绕过 mock 打真 LLM
（2026-08-30 实测：minutes 直连 provider，测试慢 25s 且烧真钱）。

约定（契约，非约定俗成）：
- 任何服务需要 LLM：`from imai import llm` + `llm.get_llm()(system, user, json_mode=...)`
- 测试注入假实现：`monkeypatch.setattr(imai.llm, "_impl", fake)`（一个 patch 点，全项目生效）
- provider 直连仅允许本模块与 eval 层（质量评估必须打真模型）
"""
from imai.integrations.llm_provider import llm_chat as _default

_impl = _default


def get_llm():
    """返回当前 LLM 调用函数，签名 (system, user, json_mode=True, max_tokens=None) -> str。
    max_tokens 缺省沿用 provider 默认 1024；推理模型做长文提取/摘要时建议 2048+。"""
    return _impl
