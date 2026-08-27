#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 动作执行服务（Step2 提炼，收敛 routes 双份确认卡构建）

统一承接「AI 判定结果 → 确认卡私聊 + AI 助手会话 + 溯源标注 + SSE 播报」的副作用链。
调用方：sync 的 handle_openim_callback、async 的 imai.worker。
"""
from imai.db import get_conn
from imai.integrations import openim_client
from imai.repos import audit_log
from imai.services.ai_dm import ai_dm_send
from imai.services.bus import fanout
from imai.services.memory import memory_proofs


def build_confirm_text(task):
    """构建私聊确认消息文本。带溯源标注（M4-S6）。文案逐字保留。"""
    candidates = task.get("candidates", [])
    lines = ["【IMAI 任务确认】"]
    lines.append(f"你刚安排的任务：{task['content']}")
    lines.append("检测到多个可能的负责人：")
    for i, c in enumerate(candidates, 1):
        lines.append(f"{i}. {c['label']}")
    lines.append("请回复数字选择负责人，或回复\"取消\"跳过。")
    proofs = task.get("proofs") or []
    if proofs:
        lines.append("")
        lines.append("（依据：" + "；".join(p["term"] + "=" + (p.get("meaning") or "") for p in proofs[:3]) + "）")
    return "\n".join(lines)


def execute_ai_actions(result, sender_id=None, group_id="", source="worker"):
    """按判定结果执行副作用并播报。

    - confirm_assignee：溯源标注 → 写 ai_dm 出站 → OpenIM 私聊推送 → SSE 播报
    - task_created：SSE 播报
    返回 {"action": ..., "taskId"?, "ok"?/"error"?}
    """
    action = result.get("action")
    if action == "confirm_assignee":
        task = result.get("task", {})
        con_proof = get_conn()
        try:
            task["proofs"] = memory_proofs(con_proof, task.get("content") or result.get("message") or "")
        finally:
            con_proof.close()
        text = build_confirm_text(task)
        con = get_conn()
        try:
            ai_dm_send(con, sender_id, text, task_id=task.get("taskId"), direction="out")
        finally:
            con.close()
        audit_log(con_probe := get_conn(), "ai", "action_execute",
                  {"kind": "dm_out", "taskId": task.get("taskId"), "source": source})
        con_probe.close()
        try:
            openim_client.send_private_confirm(group_id, sender_id, text)
        except Exception as e:
            return {"action": "confirm_assignee", "ok": False, "error": str(e)}
        fanout("ai.card", {"taskId": task.get("taskId"),
                           "assignee_candidates": task.get("candidates", []),
                           "source": source})
        return {"action": "confirm_assignee_sent", "taskId": task.get("taskId")}
    elif action == "task_created":
        task = result.get("task", {})
        audit_log(get_conn(), "ai", "action_execute",
                  {"kind": "none", "taskId": task.get("taskId"), "source": source})
        fanout("task_created", {"taskId": task.get("taskId"),
                                "assignee": task.get("assignee"),
                                "content": task.get("content"),
                                "source": source})
        return {"action": "task_created", "taskId": task.get("taskId")}
    return {"action": action or "skip", "handled": False}
