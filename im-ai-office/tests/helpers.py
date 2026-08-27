#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Guard 测试公共构造器（避免与各目录 conftest 同名冲突，经 tests.helpers 导入）"""


def make_intent(content=None, is_task=True, confidence="high",
                assignee_hint=None, deadline_hint=None, assign_mode="self"):
    """构造与 core.intent_detect schema 一致的 mock LLM 输出"""
    return {"is_task": is_task, "confidence": confidence,
            "content": content, "assignee_hint": assignee_hint,
            "deadline_hint": deadline_hint, "assign_mode": assign_mode}
