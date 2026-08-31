#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LLM Provider（自 core.llm_chat 1:1 迁移 + 迭代 2 重试加固）

OpenAI 兼容 chat/completions；json_mode 走 response_format=json_object。
注：urllib 实现为 Step1 有意保留（行为不变优先）；httpx 化属后续独立小步。

迭代 2（Spec：部署收尾与LLM重试Spec.md §R2）：DeepSeek 实测存在间歇性空响应与
瞬时网络错误，单次调用会静默漏判（上层 intent_detect 兜底 is_task=False）。
现加入自动重试：
- 可重试：URLError/超时、HTTPError 5xx/408/429、HTTP 200 但非法 JSON / 缺 choices / 空 content
- 不重试：HTTPError 其他 4xx（认证/参数错误重试无意义，立即抛）
- 总尝试 = 1 + IMAI_LLM_RETRIES（默认 2），指数退避 0.5s × 2^n
- 重试耗尽抛最后一个异常，由 intent_detect 现有 except 兜底承接（上层契约零变化）

测试锚点：Guard 层 monkeypatch 本模块导出后的 pipeline.llm_chat 绑定（不经过本模块）；
本模块单测注入点为 _post 与 _sleep。
"""
import json
import time
import urllib.error
import urllib.request

from imai.config import LLM_API_KEY, LLM_BASE, LLM_MODEL, LLM_RETRIES

# 总尝试 = 1 + LLM_RETRIES（config 从 IMAI_LLM_RETRIES 读取，默认重试 2 次）
BACKOFF_BASE_SEC = 0.5  # 第 n 次重试前等待 0.5 × 2^(n-1) 秒

_sleep = time.sleep  # 模块级封装，测试可置零


def _post(payload):
    """单次 HTTP POST，返回解析后的 JSON body；失败抛 URLError/HTTPError/ValueError。"""
    req = urllib.request.Request(
        f"{LLM_BASE}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        return json.loads(resp.read().decode())


def _content_of(data):
    """取 choices[0].message.content；结构异常或空 content 返回 None（触发重试）。"""
    try:
        return data["choices"][0]["message"]["content"] or None
    except (KeyError, IndexError, TypeError):
        return None


def llm_chat(system, user, json_mode=True, max_tokens=None):
    payload = {
        "model": LLM_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.2,
        "max_tokens": int(max_tokens) if max_tokens else 1024,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    last_err = None
    for attempt in range(1 + LLM_RETRIES):
        if attempt:
            _sleep(BACKOFF_BASE_SEC * (2 ** (attempt - 1)))
        try:
            content = _content_of(_post(payload))
            if content is not None:
                return content
            last_err = RuntimeError("LLM 空响应/响应结构异常")
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code not in (408, 429):
                raise  # 认证/参数类错误，重试无意义
            last_err = e
        except (urllib.error.URLError, OSError, ValueError) as e:
            last_err = e  # 网络错误/超时（URLError⊂OSError）与非 JSON 响应体（JSONDecodeError⊂ValueError）
    raise last_err
