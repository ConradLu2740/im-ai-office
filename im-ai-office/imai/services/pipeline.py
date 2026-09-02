#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 编排管线服务（自 core.py:328-442 1:1 迁移）：意图判定 → 归属判定 → 落库

意图 prompt/schema、归属三分支、歧义落库分支均逐字保留。
测试锚点：LLM 调用统一走 imai/llm.py 锚点（DX Spec D3），测试 patch llm._impl。
"""
import json

from imai.config import EVENTS
from imai import llm
from imai.repos import (audit_log, distinct_alias_names, find_persons_by_alias,
                        insert_task)


def to_bool(v):
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() == "true"


def intent_detect(msg, sys_ctx=""):
    schema = {
        "is_task": "boolean", "confidence": "high|medium|low",
        "content": "string", "assignee_hint": "string|nullable(用'我'表示说话人)",
        "deadline_hint": "string|nullable", "assign_mode": "assigned|self|third_party|none",
        "is_completion": "boolean(消息表示某事已做完时 true，否则 false)",
    }
    system = (
        "你是办公群聊里的任务识别助手。只在消息确实安排/认领任务时 is_task=true。"
        "分清：明确指派(@某人或'你负责')=assigned；主动认领('我来')=self；第三人称指派('让小张跟一下')=third_party；无归属=none。"
        "指出某项具体工作还没人做/没人负责（如'XX还没人做呢'）也是待认领任务：is_task=true、assign_mode=none。"
        "消息表示某件事/任务已经做完（如'做完了''搞定了''XX已交付'）时：is_task=false、is_completion=true、content=完成的事项；"
        "纯抱怨或闲聊不是任务；明确否认（'这不是任务'）时 is_task=false。不要臆断。输出严格JSON：" + json.dumps(schema, ensure_ascii=False)
    )
    if sys_ctx:
        system += "\n" + sys_ctx
    raw = llm.get_llm()(system, "判断这条群聊消息是否在安排任务；是则提取内容/负责人/截止：\n消息：" + msg)
    try:
        intent = json.loads(raw)
        # 规范化 LLM 输出：is_task 偶发返回字符串 "true"/"false"，统一转布尔，避免下游 `is True` 断言/前端展示不稳定
        if isinstance(intent, dict):
            intent["is_task"] = to_bool(intent.get("is_task"))
        return intent
    except Exception:
        return {"is_task": False, "confidence": "low"}


# ============ 归属判定（别名消歧 + 认领模式）============
def find_by_alias(con, name):
    return find_persons_by_alias(con, name)


def resolve(con, msg, sender="李娜(娜姐)", intent=None):
    mode = (intent or {}).get("assign_mode", "none")
    if mode == "self":
        return {"assignee": sender, "confidence": "high", "candidates": [], "mode": mode, "ambiguous": False}
    names = distinct_alias_names(con)
    hits = []
    for n in names:
        if n and n in msg:
            hits.extend(find_by_alias(con, n))
    seen, uniq = set(), []
    for h in hits:
        if h["id"] not in seen:
            seen.add(h["id"]); uniq.append(h)
    if len(uniq) == 0:
        hint = (intent or {}).get("assignee_hint")
        return {"assignee": hint or None, "confidence": "low", "candidates": [], "mode": mode, "ambiguous": False}
    if len(uniq) == 1:
        return {"assignee": uniq[0]["real_name"] + "/" + (uniq[0]["flower_name"] or ""),
                "confidence": "high", "candidates": uniq, "mode": mode, "ambiguous": False}
    labels = [{"person_id": r["id"], "label": f"{r['real_name']}({r['flower_name']})"} for r in uniq]
    return {"assignee": None, "confidence": "medium", "candidates": uniq, "mode": mode, "ambiguous": True,
            "ambiguous_labels": labels}


# ============ 主流程 ============

def handle_completion(con, msg, sender, content_hint=None):
    """G1 口头完成（最小版，宁漏勿错，工作流缺口登记 Spec §1.1）：

    在该成员（assignee 与 sender 互相 LIKE 匹配）已确认的任务中，优先 content LIKE 命中，
    否则取最近一条；命中多条取最近；无匹配不动任何任务。"""
    from imai.services import bus
    from imai.services.tasks import complete_task
    c = con.cursor()
    s = (sender or "").strip()
    if not s:
        return None
    c.execute("SELECT * FROM task WHERE status='confirmed' AND assignee LIKE ? "
              "ORDER BY id DESC", (f"%{s}%",))
    from imai.db import _rows as _extract
    tasks = _extract(c)
    if not tasks:
        return None
    hint = (content_hint or "").strip()
    picked = None
    if hint:
        for t in tasks:
            if hint[:4] and hint[:4] in (t["content"] or ""):
                picked = t
                break
    picked = picked or tasks[0]
    if complete_task(con, picked["id"], actor=f"user:{s}"):
        bus.fanout("task_completed", {"taskId": picked["id"], "by": "chat"})
        return picked
    return None


def process_message(msg, sender="李娜(娜姐)", group_id=None):
    """跑完整链路，返回结构化结果。group_id 用于群级上下文注入。
    【现状缺陷登记】同 msg 重复投递会重复建任务（无去重）；g1_5 锁定实证，
    Step2 事件化时以 event_dedup/msgId 一并解决。
    【现状缺陷登记】process_message 每次新建连接未显式 close（历史上即如此）；
    Step2 重构入口与连接管理时统一治理。"""
    from imai.db import init_db   # 历史行为：init 兼建表（原 core.init_db 同名同责）
    con = init_db()
    sys_ctx = build_sys_ctx_stub(con, group_id) if group_id else ""
    intent = intent_detect(msg, sys_ctx=sys_ctx)
    base = {"message": msg, "sender": sender, "intent": intent}
    if not to_bool(intent.get("is_task")):
        # G1 口头完成：is_completion 命中 → 尝试标记对应任务 done（宁漏勿错）
        if to_bool(intent.get("is_completion")):
            picked = handle_completion(con, msg, sender, content_hint=intent.get("content"))
            base["action"] = "task_completed" if picked else "skip"
            if picked:
                base["completed_task"] = {"taskId": picked["id"], "content": picked["content"]}
            return base
        base["action"] = "skip"  # 非任务，静默
        return base

    assign = resolve(con, msg, sender, intent)
    base["assign"] = assign

    if assign.get("ambiguous"):
        # 有歧义 -> 先落库 pending_assignee，再由 app.py 私聊发送者确认
        content = intent.get("content") or msg
        deadline = intent.get("deadline_hint")
        pending_meta = json.dumps({"candidates": assign.get("ambiguous_labels", [])}, ensure_ascii=False)
        task_id = insert_task(con, content, sender, None, deadline, "pending_assignee",
                              intent.get("confidence"), msg, pending_meta=pending_meta)
        audit_log(con, "ai", "identify_ambiguous",
                  {"taskId": task_id, "content": content, "candidates": assign.get("ambiguous_labels", [])})
        base["action"] = "confirm_assignee"
        base["needs_confirmation"] = True
        base["task"] = {"taskId": task_id, "content": content, "assignee": None,
                        "deadline": deadline, "status": "pending_assignee",
                        "candidates": assign.get("ambiguous_labels", [])}
        return base

    assignee = assign.get("assignee") or "待指派"
    content = intent.get("content") or msg
    deadline = intent.get("deadline_hint")

    task_id = insert_task(con, content, sender, assignee, deadline,
                          "pending_confirmation", intent.get("confidence"), msg)
    audit_log(con, "ai", "task_created",
              {"taskId": task_id, "content": content, "assignee": assignee, "deadline": deadline})
    # 入事件队列
    EVENTS.append({"event": "task.created", "taskId": task_id, "assignee": assignee, "deadline": deadline})
    base["action"] = "task_created"
    base["task"] = {"taskId": task_id, "content": content, "assignee": assignee,
                    "deadline": deadline, "status": "pending_confirmation"}
    return base


def audit_ai_processed(con, msg_id, result, content, source, latency_ms):
    """G9：sync 路径统一 ai_processed 审计（格式对齐 worker 路径，source 区分入口）。

    worker 异步路径仍自带同格式审计；本 helper 供所有 sync 调用点使用，
    保证线上质量统计（识别质量统计Spec）覆盖全部真实流量。
    """
    from imai.repos import audit_log
    audit_log(con, "api", "ai_processed",
              {"msgId": msg_id,
               "action": result.get("action"),
               "taskId": (result.get("task") or {}).get("taskId"),
               "content": (content or "")[:60],
               "latency_ms": int(latency_ms),
               "source": source})


def build_sys_ctx_stub(con, group_id):
    """注入上下文构建。原实现在 core.memory 区段——委托 memory 服务保持单一来源。"""
    from imai.services.memory import build_sys_ctx as _real
    return _real(con, group_id)
