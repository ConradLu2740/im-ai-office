#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""任务/消息路由（自旧 app.py 1:1 迁移）：chat / simulate / sdk_message / tasks / messages"""
import json
import time
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from imai.config import EVENTS
from imai.db import get_conn, init_db
from imai.integrations import openim_client
from imai.repos import message_add, message_list
from imai.services.actions import build_confirm_text as _build_confirm_text
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


class TaskUpdateIn(BaseModel):
    assignee: Optional[str] = None
    deadline: Optional[str] = None
    action: Optional[str] = None  # 仅支持 "cancel"


class ResolveIn(BaseModel):
    sender_id: str
    choice: str
    task_id: Optional[int] = None


def _extract_text_content(raw):
    """OpenIM 文本消息 content 可能是字符串或 {'content':'...'}。"""
    if isinstance(raw, dict):
        return str(raw.get("content") or raw.get("text") or "")
    return str(raw or "")


@router.post("/api/chat")
def chat(body: ChatIn):
    """提交一条群消息，跑完整识别/归属/落库链路，返回判定结果。"""
    _t0 = time.perf_counter()
    result = process_message(body.message, body.sender)
    from imai.services.pipeline import audit_ai_processed
    audit_ai_processed(get_conn(), None, result, body.message, "chat",
                       (time.perf_counter() - _t0) * 1000)
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
    # 迭代1（缺陷#3）：确定性 msgId 去重——sync/async 统一，重放不重复建任务
    from imai.services import bus
    msg_id = body.get("msg_id") or bus.deterministic_msg_id(conv_id, sender, text)
    con = get_conn()
    try:
        if bus.is_duplicate(con, msg_id):
            from imai.repos import audit_log
            audit_log(con, "entry", "ai_dedup_skip", {"msgId": msg_id, "source": "simulate"})
            return {"ok": True, "dedup": True, "msg_id": msg_id}
    finally:
        con.close()
    # 入库（作为别人的消息 is_self=0）
    con = get_conn()
    try:
        message_add(con, conv_id, "sim_user", sender, text, is_self=0)
    finally:
        con.close()
    # async 模式：AI 判定入队异步处理（Spec §2 矩阵）；sync 模式走原同步链路
    from imai import config
    if config.AI_MODE == "async":
        r = bus.make_redis_client()
        eid = bus.publish_message(r, conv_id, "sim_user", sender, text,
                                  msg_id=msg_id, source="simulate")
        bus.mark_consumed(get_conn(), msg_id)
        return {"ok": True, "accepted": True, "queued_event": str(eid), "msg_id": msg_id}
    # AI 识别（迭代1 缺陷#4：conv_id 透传，记忆注入覆盖 simulate 路径）
    _t0 = time.perf_counter()
    ai_result = process_message(text, sender, group_id=conv_id)
    from imai.services.pipeline import audit_ai_processed
    audit_ai_processed(get_conn(), msg_id, ai_result, text, "simulate",
                       (time.perf_counter() - _t0) * 1000)
    bus.mark_consumed(get_conn(), msg_id)
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
    # 迭代1（缺陷#3）：确定性 msgId 去重
    from imai.services import bus
    msg_id = body.get("msg_id") or bus.deterministic_msg_id(conv_id, sender, text)
    # SDK 重连重投递防重放：网关附带 clientMsgID，同 ID 已入库视为已处理（永久闸门，
    # 30 分钟去重窗口覆盖不了长时间后的重连重推，2026-08-30 实证 90 分钟后重放重复建任务）
    client_msg_id = (body.get("client_msg_id") or "").strip()
    con = get_conn()
    try:
        if client_msg_id:
            _c = con.cursor()
            _c.execute("SELECT 1 FROM message WHERE conv_id=? AND client_msg_id=? LIMIT 1",
                       (conv_id, client_msg_id))
            if _c.fetchone():
                return {"ok": True, "dedup": True, "msg_id": msg_id,
                        "reason": "client_msg_id_seen"}
        if bus.is_duplicate(con, msg_id):
            from imai.repos import audit_log
            audit_log(con, "entry", "ai_dedup_skip", {"msgId": msg_id, "source": "sdk"})
            return {"ok": True, "dedup": True, "msg_id": msg_id}
    finally:
        con.close()
    # 入库（收到的消息 is_self=0）
    con = get_conn()
    try:
        message_add(con, conv_id, send_id or "sdk_user", sender, text, is_self=0,
                    client_msg_id=client_msg_id or None)
    finally:
        con.close()
    # async 模式：AI 判定入队（消息本体已同步入库展示）
    from imai import config
    if config.AI_MODE == "async":
        r = bus.make_redis_client()
        eid = bus.publish_message(r, conv_id, send_id or "sdk_user", sender, text,
                                  msg_id=msg_id, source="sdk")
        bus.mark_consumed(get_conn(), msg_id)
        return {"ok": True, "accepted": True, "queued_event": str(eid), "msg_id": msg_id}
    # AI 识别（迭代1 缺陷#4：conv_id 透传，记忆注入覆盖 sdk 路径）
    _t0 = time.perf_counter()
    ai_result = process_message(text, sender, group_id=conv_id)
    from imai.services.pipeline import audit_ai_processed
    audit_ai_processed(get_conn(), msg_id, ai_result, text, "sdk_message",
                       (time.perf_counter() - _t0) * 1000)
    bus.mark_consumed(get_conn(), msg_id)
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


@router.patch("/api/tasks/{task_id}")
def task_update(task_id: int, body: TaskUpdateIn):
    """迭代2 B1：已确认任务修改（改负责人/改期重置提醒/取消）。"""
    from fastapi import HTTPException
    if body.action not in (None, "cancel"):
        raise HTTPException(400, "action 仅支持 cancel")
    if body.assignee is None and body.deadline is None and body.action is None:
        raise HTTPException(400, "没有任何变更字段")
    from imai.services.tasks import update_task
    con = get_conn()
    try:
        row, err = update_task(con, task_id, assignee=body.assignee,
                               deadline=body.deadline, cancel=(body.action == "cancel"))
        if err == "task_not_found":
            raise HTTPException(404, "任务不存在")
        if err == "bad_deadline":
            raise HTTPException(400, "deadline 格式需为 YYYY-MM-DD HH:MM")
        if err == "no_changes":
            raise HTTPException(400, "没有任何变更字段")
        from imai.repos import get_task_dict
        return {"ok": True, "task": get_task_dict(con, task_id)}
    finally:
        con.close()


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
