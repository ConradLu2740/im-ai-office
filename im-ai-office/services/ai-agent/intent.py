# 意图判定器（快路径）：判断消息是否任务、提取负责人/截止/内容
# 使用 LLM 结构化输出；输入注入群级团队记忆（群简介/术语/人名字典）
from dataclasses import dataclass, field
from typing import Optional

from llm_provider import LLMProvider

INTENT_SCHEMA = {
    "is_task": "boolean",
    "confidence": "high|medium|low",
    "content": "string (任务内容，若 is_task)",
    "assignee_hint": "string|nullable (负责人称谓或用('我')表示说话人)",
    "deadline_hint": "string|nullable (截止，如'周五前')",
    "assign_mode": "assigned|self|third_party|none",
}


@dataclass
class IntentResult:
    is_task: bool
    confidence: str = "low"
    content: str = ""
    assignee_hint: Optional[str] = None
    deadline_hint: Optional[str] = None
    assign_mode: str = "none"
    raw: dict = field(default_factory=dict)


def build_system_context(grp_intro: str, terms: list[str], people: list[str]) -> str:
    """拼装团队记忆注入上下文（只注入当前群，控制 token）。"""
    parts = []
    if grp_intro:
        parts.append(f"群里简介：{grp_intro}")
    if terms:
        parts.append("术语口径：" + "；".join(f"{t[0]}={t[1]}" for t in terms))
    if people:
        parts.append("人名字典：" + "、".join(people))
    return "\n".join(parts)


class IntentDetector:
    def __init__(self, llm: LLMProvider):
        self.llm = llm

    def detect(self, message: str, system_context: str = "") -> IntentResult:
        user = f"判断下面这条群聊消息是否在安排一项任务。若是，提取负责人、截止、内容。\n消息：{message}"
        sys = (
            "你是办公群聊里的任务识别助手。"
            "只在消息确实在安排/认领任务时 is_task=true。"
            "分清：明确指派(@某人或'你负责')、主动认领('我来')、第三人称指派('让小张跟一下')、无归属。"
            "不要臆断。"
            + (("\n" + system_context) if system_context else "")
        )
        data = self.llm.structured(sys, user, INTENT_SCHEMA)
        return IntentResult(
            is_task=bool(data.get("is_task")),
            confidence=data.get("confidence", "low"),
            content=data.get("content", ""),
            assignee_hint=data.get("assignee_hint"),
            deadline_hint=data.get("deadline_hint"),
            assign_mode=data.get("assign_mode", "none"),
            raw=data,
        )
