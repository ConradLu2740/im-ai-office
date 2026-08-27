#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LLM Provider（自 core.llm_chat 1:1 迁移）

OpenAI 兼容 chat/completions；json_mode 走 response_format=json_object。
注：urllib 实现为 Step1 有意保留（行为不变优先）；httpx 化属后续独立小步。
测试锚点：Guard 层 monkeypatch 本模块导出后的 pipeline.llm_chat 绑定。
"""
import json
import urllib.request

from imai.config import LLM_API_KEY, LLM_BASE, LLM_MODEL


def llm_chat(system, user, json_mode=True):
    payload = {
        "model": LLM_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.2,
        "max_tokens": 1024,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(
        f"{LLM_BASE}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        data = json.loads(resp.read().decode())
    return data["choices"][0]["message"]["content"]
