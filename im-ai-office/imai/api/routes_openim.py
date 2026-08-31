#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""OpenIM 接入路由（自旧 app.py 1:1 迁移）：登录代理/会话/代发/回调入口 + 网关自动登录"""
import json
import os
import threading
import time
import urllib.request
import uuid

from fastapi import APIRouter, Request

from imai.api import deps

from imai import config
from imai.config import OPENIM_ADMIN_TOKEN, OPENIM_API, OPENIM_SECRET
from imai.db import get_conn
from imai.integrations import openim_client
from imai.repos import message_add
from imai.services import bus
from imai.services.actions import build_confirm_text as _build_confirm_text
from imai.services.actions import execute_ai_actions
from imai.services.ai_dm import ai_dm_send, resolve_assignee_reply
from imai.services.memory import memory_proofs
from imai.services.pipeline import process_message

router = APIRouter()

_init_db_probe_done = False


def _openim_post(path, payload, token=None):
    """调用 OpenIM REST API。"""
    headers = {"Content-Type": "application/json", "operationID": uuid.uuid4().hex}
    if token:
        headers["token"] = token
    req = urllib.request.Request(
        f"{OPENIM_API}{path}",
        data=json.dumps(payload).encode(),
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


@router.post("/openim/login")
def openim_login(body: dict):
    """用户登录：口令（若启用）+ userID 换取用户 token。"""
    denied = deps.check_login_password(body)
    if denied:
        return denied
    user_id = body.get("user_id", "").strip()
    if not user_id:
        return {"ok": False, "error": "user_id 不能为空"}
    try:
        data = _openim_post("/auth/get_user_token", {
            "secret": OPENIM_SECRET,
            # platformID=4(OSX 桌面端)：与 msg_gateway 的 Web(5) 会话分离。
            # 同 user+platform 重复签发 token 会顶掉旧 token（TokenNotExistError），
            # 曾导致 UI 每次登录都把网关踢下线、消息全部发送失败（2026-08-28 修复）
            "platformID": 4,
            "userID": user_id,
        }, token=OPENIM_ADMIN_TOKEN)
        if data.get("errCode") == 0:
            token = data["data"]["token"]
            return {"ok": True, "token": token, "user_id": user_id}
        return {"ok": False, "error": data.get("errMsg", "login failed")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/openim/conversations")
def openim_conversations(body: dict):
    """获取用户会话列表。"""
    token = body.get("token", "")
    user_id = body.get("user_id", "")
    if not token or not user_id:
        return {"ok": False, "error": "token/user_id 不能为空"}
    try:
        data = _openim_post("/conversation/get_all_conversations", {
            "ownerUserID": user_id,
        }, token=token)
        if data.get("errCode") == 0:
            return {"ok": True, "conversations": data["data"].get("conversations") or []}
        return {"ok": False, "error": data.get("errMsg", "get conversations failed")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/openim/send_message")
def openim_send_message(body: dict):
    """发送消息（管理员代发，sender 显示为当前用户）。"""
    user_id = body.get("user_id", "")
    group_id = body.get("group_id", "")
    recv_id = body.get("recv_id", "")
    sender_name = body.get("sender_name", user_id)
    text = body.get("text", "")
    if not user_id or not text:
        return {"ok": False, "error": "user_id/text 不能为空"}
    if not group_id and not recv_id:
        return {"ok": False, "error": "group_id 或 recv_id 不能为空"}
    try:
        data = _openim_post("/msg/send_msg", {
            "sendID": user_id,
            "groupID": group_id,
            "recvID": recv_id,
            "senderNickname": sender_name,
            "content": {"content": text},
            "contentType": 101,
            "sessionType": 3 if group_id else 1,
        }, token=OPENIM_ADMIN_TOKEN)
        if data.get("errCode") == 0:
            # 记录到本地 message 表
            conv_id = f"sg_{group_id}" if group_id else f"single_{user_id}_{recv_id}"
            con = get_conn()
            try:
                message_add(con, conv_id, user_id, sender_name, text, is_self=1,
                            msg_seq=data["data"].get("seq"),
                            client_msg_id=data["data"].get("serverMsgID", ""))
            finally:
                con.close()
            # 发送成功后，同步做 AI 识别（不依赖 OpenIM 回调，双保险）
            _t0 = time.perf_counter()
            ai_result = process_message(text, sender_name)
            from imai.services.pipeline import audit_ai_processed
            audit_ai_processed(get_conn(), data.get("data", {}).get("serverMsgID"),
                               ai_result, text, "openim_send",
                               (time.perf_counter() - _t0) * 1000)
            # 歧义时：写 AI 助手会话 + 发 OpenIM 私聊确认
            if ai_result.get("action") == "confirm_assignee":
                task = ai_result.get("task", {})
                confirm_text = build_confirm_text(task)
                con = get_conn()
                try:
                    ai_dm_send(con, user_id, confirm_text, task_id=task.get("taskId"), direction="out")
                finally:
                    con.close()
                try:
                    openim_client.send_private_confirm(group_id, user_id, confirm_text)
                except Exception:
                    pass
            return {"ok": True, "msgId": data["data"].get("serverMsgID", ""), "ai": ai_result}
        return {"ok": False, "error": data.get("errMsg", "send failed")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/openim/get_messages")
def openim_get_messages(body: dict):
    """获取会话历史消息（简化：先返回空，后续用 WebSocket/轮询补齐）。"""
    return {"ok": True, "messages": []}


def extract_text_content(raw):
    """OpenIM 文本消息 content 可能是字符串或 {'content':'...'}。"""
    if isinstance(raw, dict):
        return str(raw.get("content") or raw.get("text") or "")
    return str(raw or "")


def handle_openim_callback(payload: dict):
    """处理 OpenIM afterSendGroupMsg / afterSendSingleMsg 回调。"""
    # 观测日志：回调载荷形状历史上多次与预期不符（静默跳过难排查），保留关键轨迹
    print(f"[callback] keys={sorted(payload.keys())}")
    # 支持多种字段名
    msg_id = payload.get("msgID") or payload.get("msgId") or payload.get("msg_id") or ""
    grp_id = payload.get("groupID") or payload.get("group_id") or ""
    recv_id = payload.get("recvID") or payload.get("recv_id") or ""
    sender_id = payload.get("sendID") or payload.get("send_id") or ""
    sender_nickname = payload.get("senderNickname") or payload.get("sender_nickname") or sender_id
    content_type = payload.get("contentType") or payload.get("content_type") or 101
    client_msg_id = payload.get("clientMsgID") or payload.get("client_msg_id") or ""
    content = extract_text_content(payload.get("content", ""))

    if not content:
        print(f"[callback] empty_content! payload={json.dumps(payload, ensure_ascii=False)[:400]}")
        return {"ok": True, "handled": False, "reason": "empty_content"}

    # 文本消息才处理
    if int(content_type) != 101:
        return {"ok": True, "handled": False, "reason": "not_text"}

    # 群消息：AI 旁听并识别任务
    if grp_id:
        # 网关自发送（platform 5）：历史落库与 AI 都由前端 sdk_message 路径负责；
        # 回调再处理会同消息双写双触发（实证 #79/#80 重复任务），直接跳过。
        # 此分支仅服务来自其他客户端的消息（落库 + AI）。
        if int(payload.get("senderPlatformID") or 0) == 5:
            return {"ok": True, "handled": True, "action": "owned_by_sdk_path"}
        # 落库历史（此前回调只触发 AI、从不存消息 → UI 进群永远空白，2026-08-28 补上）；
        # content 可能是 JSON 包装串，清洗为纯文本
        content_clean = content
        try:
            _inner = json.loads(content)
            if isinstance(_inner, dict) and isinstance(_inner.get("content"), str):
                content_clean = _inner["content"]
        except Exception:
            pass
        con = get_conn()
        try:
            # 永久幂等闸门：同 clientMsgID 已入库 → 另一路径（sdk_message）已处理，跳过 AI
            # （防 SDK 重连重投递导致重复建任务，2026-08-30 实证）
            if client_msg_id:
                _c = con.cursor()
                _c.execute("SELECT 1 FROM message WHERE conv_id=? AND client_msg_id=? LIMIT 1",
                           (f"sg_{grp_id}", client_msg_id))
                if _c.fetchone():
                    return {"ok": True, "handled": True, "action": "client_msg_id_seen"}
            message_add(con, f"sg_{grp_id}", sender_id, sender_nickname, content_clean, is_self=0,
                        client_msg_id=client_msg_id or None)
        finally:
            con.close()
        _t0 = time.perf_counter()
        result = process_message(content, sender_nickname, group_id=grp_id)
        from imai.services.pipeline import audit_ai_processed
        audit_ai_processed(get_conn(), client_msg_id or None, result, content_clean,
                           "openim_callback", (time.perf_counter() - _t0) * 1000)
        if result.get("action") == "confirm_assignee":
            # 副作用链收敛至 services.actions（溯源标注/ai_dm/OpenIM 私聊/SSE 播报）
            executed = execute_ai_actions(result, sender_id=sender_id, group_id=grp_id,
                                          source="callback_sync")
            if not executed.get("ok", True):
                return {"ok": False, "handled": False, "action": "confirm_assignee",
                        "error": executed.get("error")}
            return {"ok": True, "handled": True, "action": "confirm_assignee_sent",
                    "taskId": executed.get("taskId")}
        elif result.get("action") == "task_created":
            return {"ok": True, "handled": True, "action": "task_created", "taskId": result["task"]["taskId"]}
        else:
            return {"ok": True, "handled": False, "action": "skip"}

    # 单聊消息：处理私聊确认回复（发给 AI 助手或系统账号）
    if recv_id and not grp_id:
        # 只处理发给 AI 助手/系统账号的回复
        # 【现状缺陷登记】此处检查 action=='assigned' 但 resolve_assignee_reply 返回
        # 'confirmed'，告知分支不可达；g2_5 docstring 锁定记录，待修复。
        con = get_conn()
        try:
            resolved = resolve_assignee_reply(con, sender_nickname, content)
            if resolved.get("ok") and resolved.get("action") == "confirmed":
                # 可选：再私聊发送者告知已确认
                try:
                    text = f"【IMAI】已确认负责人：{resolved['assignee']}\n任务：{resolved.get('taskId')}"
                    openim_client.send_private_confirm("", sender_id, text)
                except Exception:
                    pass
            return {"ok": True, "handled": True, "action": "private_reply", "result": resolved}
        finally:
            con.close()

    return {"ok": True, "handled": False}


@router.post("/callback")
async def openim_callback(request: Request):
    """OpenIM 消息回调入口。

    sync（默认）：同步处理（Step1 行为）；async：校验后入队立即受理返回。
    """
    body = await request.body()
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return {"ok": False, "error": "invalid json"}
    denied = deps.check_callback_token(request)
    if denied:
        return denied
    if config.AI_MODE == "async":
        content = extract_text_content(payload.get("content", ""))
        if not content:
            return {"ok": True, "handled": False, "reason": "empty_content"}
        grp_id = payload.get("groupID") or payload.get("group_id") or ""
        r = bus.make_redis_client()
        eid = bus.publish_message(
            r, grp_id,
            payload.get("sendID") or payload.get("send_id") or "",
            payload.get("senderNickname") or payload.get("sender_nickname") or "",
            content,
            msg_id=payload.get("msgID") or payload.get("msgId") or payload.get("msg_id"),
            source="callback")
        return {"ok": True, "accepted": True, "queued_event": str(eid)}
    return handle_openim_callback(payload)


@router.post("/callback/{command}")
async def openim_callback_command(request: Request, command: str):
    """OpenIM 实际回调 URL = 配置 URL + /命令名（如
    /callback/callbackAfterSendGroupMsgCommand）；统一转交 /callback 处理
    （2026-08-28 修复：此前子路径 404，群消息从未落库/触发 AI）。"""
    return await openim_callback(request)


# ============ 网关自动登录（启动后台线程，全兜底不阻塞）============

def gateway_auto_login():
    """后端启动后自动登录 OpenIM 网关：换 token → /gw/login → 轮询连接。
    失败仅记日志，不阻塞后端启动（后台线程）。"""
    def _do():
        try:
            user_id = os.environ.get("GW_LOGIN_USER", "user001")
            # Tauri 启动顺序：先起后端、后端就绪后才起网关；这里等网关就绪（最多 30s）
            for attempt in range(15):
                try:
                    with urllib.request.urlopen("http://127.0.0.1:8400/gw/ping", timeout=2) as r:
                        json.loads(r.read())
                    break
                except Exception:
                    if attempt == 14:
                        print("[gw-auto] 网关 30s 内未就绪，放弃自动登录（后端继续运行）")
                        return
                    time.sleep(2)
            data = _openim_post("/auth/get_user_token", {
                "secret": OPENIM_SECRET,
                "platformID": 5,
                "userID": user_id,
            }, token=OPENIM_ADMIN_TOKEN)
            if data.get("errCode") != 0:
                print(f"[gw-auto] 换 token 失败: {data.get('errMsg')}")
                return
            token = data["data"]["token"]
            payload = json.dumps({"userID": user_id, "token": token}).encode()
            req = urllib.request.Request(
                "http://127.0.0.1:8400/gw/login", data=payload,
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                print(f"[gw-auto] /gw/login -> {resp.read().decode()[:120]}")
            for _ in range(20):  # 最多 10s 等网关连上
                time.sleep(0.5)
                try:
                    with urllib.request.urlopen("http://127.0.0.1:8400/gw/ping", timeout=2) as r:
                        if json.loads(r.read()).get("connected"):
                            print(f"[gw-auto] OpenIM 网关已连接 user={user_id}")
                            return
                except Exception:
                    pass
            print("[gw-auto] 网关连接超时（10s），后端继续运行")
        except Exception as e:
            print(f"[gw-auto] 自动登录网关失败(忽略): {e}")

    threading.Thread(target=_do, daemon=True).start()
