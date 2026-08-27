#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""任务/消息路由（自旧 app.py 1:1 迁移）：chat / simulate / sdk_message / tasks / messages"""
import json
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from imai.config import EVENTS
from imai.db import get_conn, init_db
from imai.integrations import openim_client
from imai.repos import message_add, message_list
from imai.services.ai_dm import ai_dm_send, resolve_task_by_choice
from imai.services.pipeline import process_message
from imai.services.tasks import confirm_task as _confirm_task, reject_task as _reject_task

router = APIRouter()


class ChatIn(BaseModel):
    message: str
    sender: str = "李娜(娜姐)"


class ConfirmIn(BaseModel):
    assignee: Optional[str] = None
    deadline: Optional[str] = None


class RejectIn(BaseModel):
    reason: str = ""


class ResolveIn(BaseModel):
    sender_id: str
    choice: str
    task_id: Optional[int] = None


def _extract_text_content(raw):
    """OpenIM 文本消息 content 可能是字符串或 {'content':'...'}。"""
    if isinstance(raw, dict):
        return str(raw.get("content") or raw.get("text") or "")
    return str(raw or "")


def _build_confirm_text(task):
    """构建私聊确认消息文本。带溯源标注（M4-S6）。"""
    candidates = task.get("candidates", [])
    lines = ["【IMAI 任务确认】"]
    lines.append(f"你刚安排的任务：{task['content']}")
    lines.append("检测到多个可能的负责人：")
    for i, c in enumerate(candidates, 1):
        lines.append(f"{i}. {c['label']}")
    lines.append("请回复数字选择负责人，或回复\"取消\"跳过。")
    # M4-S6 溯源标注：任务命中团队记忆则附依据
    proofs = task.get("proofs") or []
    if proofs:
        lines.append("")
        lines.append("（依据：" + "；".join(p["term"] + "=" + (p.get("meaning") or "") for p in proofs[:3]) + "）")
    return "\n".join(lines)


@router.post("/api/chat")
def chat(body: ChatIn):
    """提交一条群消息，跑完整识别/归属/落库链路，返回判定结果。"""
    result = process_message(body.message, body.sender)
    result["events"] = EVENTS[-3:]  # 最近事件（演示透出）
    return result


@router.get("/api/tasks")
def tasks(status: Optional[str] = None):
    from imai.services.memory import memory_proofs
    con = get_conn()
    rows = _list_tasks(con, status)
    # M4-S6 溯源：任务命中团队记忆则附依据
    for row in rows:
        row["proofs"] = memory_proofs(con, row.get("content") or row.get("source_msg") or "")
    con.close()
    return {"tasks": rows, "events": EVENTS[-5:]}


def _list_tasks(con, status=None):
    from imai.services.tasks import list_tasks
    return list_tasks(con, status)


@router.post("/api/simulate_message")
def simulate_message(body: dict):
    """模拟一条群消息（不依赖 OpenIM），触发 AI 识别 + 入库 + 显示。
    【现状缺陷登记】不透传 group_id，群级记忆注入仅 callback 链路生效；Step1 后补齐。"""
    sender = body.get("sender", "同事")
    text = body.get("text", "")
    conv_id = body.get("conv_id", "sg_simulated")
    if not text:
        return {"ok": False, "error": "text 不能为空"}
    # 入库（作为别人的消息 is_self=0）
    con = get_conn()
    try:
        message_add(con, conv_id, "sim_user", sender, text, is_self=0)
    finally:
        con.close()
    # AI 识别
    ai_result = process_message(text, sender)
    # 歧义时：写 AI 助手会话
    if ai_result.get("action") == "confirm_assignee":
        task = ai_result.get("task", {})
        confirm_text = _build_confirm_text(task)
        con = get_conn()
        try:
            ai_dm_send(con, "sim_user", confirm_text, task_id=task.get("taskId"), direction="out")
        finally:
            con.close()
    return {"ok": True, "ai": ai_result, "message": ai_result.get("message", text)}


@router.post("/api/sdk_message")
def sdk_message(body: dict):
    """SDK 收到的 OpenIM 实时消息：AI 识别 + 入库 + 显示。"""
    sender = body.get("sender", "同事")
    text = body.get("text", "")
    conv_id = body.get("conv_id", "sg_sdk")
    send_id = body.get("send_id", "")
    if not text:
        return {"ok": False, "error": "text 不能为空"}
    # 入库（收到的消息 is_self=0）
    con = get_conn()
    try:
        message_add(con, conv_id, send_id or "sdk_user", sender, text, is_self=0)
    finally:
        con.close()
    # AI 识别
    ai_result = process_message(text, sender)
    # 歧义时：写 AI 助手会话
    if ai_result.get("action") == "confirm_assignee":
        task = ai_result.get("task", {})
        confirm_text = _build_confirm_text(task)
        con = get_conn()
        try:
            ai_dm_send(con, send_id or "sdk_user", confirm_text, task_id=task.get("taskId"), direction="out")
        finally:
            con.close()
    return {"ok": True, "ai": ai_result, "message": ai_result.get("message", text)}


@router.get("/api/messages")
def messages(conv_id: Optional[str] = None):
    con = get_conn()
    rows = message_list(con, conv_id)
    con.close()
    return {"messages": rows}


@router.post("/api/tasks/{task_id}/confirm")
def confirm(task_id: int, body: ConfirmIn = None):
    body = body or ConfirmIn()
    con = get_conn()
    ok = _confirm_task(con, task_id, body.assignee, body.deadline)
    con.close()
    return {"ok": ok}


@router.post("/api/tasks/{task_id}/reject")
def reject(task_id: int, body: RejectIn = None):
    body = body or RejectIn()
    con = get_conn()
    ok = _reject_task(con, task_id, body.reason)
    con.close()
    return {"ok": ok}


@router.post("/api/tasks/resolve")
def resolve(body: ResolveIn):
    con = get_conn()
    try:
        result = resolve_task_by_choice(con, body.sender_id, body.choice, body.task_id)
        if result.get("ok"):
            # 写入已确认回复到 ai_dm
            text = f"已确认负责人：{result.get('assignee')}"
            ai_dm_send(con, body.sender_id, text, task_id=result.get("taskId"), direction="in")
        return result
    finally:
        con.close()
