# LLM provider 抽象层
# MVP 对接云端（OpenAI 兼容协议）；之后切本地部署，只改配置不改代码。
import os
import json
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class LLMResult:
    text: str
    raw: Any = None


class LLMProvider:
    """统一 LLM 接口。支持 OpenAI 兼容端点（云端/本地 Ollama/vLLM 均可）。"""

    def __init__(self):
        self.base = os.environ.get("LLM_BASE", "https://api.openai.com/v1").rstrip("/")
        self.api_key = os.environ.get("LLM_API_KEY", "")
        self.model = os.environ.get("LLM_MODEL", "gpt-4o-mini")

    def chat(self, messages, temperature: float = 0.2, json_mode: bool = False) -> LLMResult:
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {"model": self.model, "messages": messages, "temperature": temperature}
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        resp = httpx.post(f"{self.base}/chat/completions", headers=headers, json=payload, timeout=30)
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"]
        return LLMResult(text=text, raw=resp.json())

    def chat_json(self, messages) -> dict:
        """强制 JSON 输出（用于意图判定等结构化场景）。"""
        res = self.chat(messages, json_mode=True)
        try:
            return json.loads(res.text)
        except json.JSONDecodeError:
            # 兜底：去掉可能的 markdown 代码围墙
            cleaned = res.text.strip().strip("`")
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
            return json.loads(cleaned)

    def structured(self, system: str, user: str, output_schema: dict) -> dict:
        """带 schema 约束的结构化输出（意图判定）。"""
        sys = system + "\n输出必须是如下 JSON 结构，不要多余文字：\n" + json.dumps(output_schema, ensure_ascii=False)
        return self.chat_json([{"role": "system", "content": sys}, {"role": "user", "content": user}])
