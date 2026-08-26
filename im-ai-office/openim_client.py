#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""OpenIM 回写客户端：AI 主动发消息到群/私聊（确认卡、提醒、消歧确认）。

OpenIM 发消息 REST API：POST {API_ADDRESS}/msg/send_msg
- 群聊：sessionType=3，带 groupID
- 单聊/私聊：sessionType=1，带 recvID
- 文本 contentType=101；需要 `operationID` + `token`(admin) header

参考：https://docs.openim.io/zh/platform-api/message/sending-messages/send-msg
"""
import json
import time
import uuid
import urllib.request

API_ADDRESS = None  # e.g. http://openim-api:10002  (由环境变量覆盖)
ADMIN_TOKEN = None  # OpenIM admin token
SENDER_ID = None


def _configure():
    global API_ADDRESS, ADMIN_TOKEN, SENDER_ID
    import os
    API_ADDRESS = os.environ.get("OPENIM_API", "http://localhost:10002")
    ADMIN_TOKEN = os.environ.get("OPENIM_ADMIN_TOKEN", "")
    SENDER_ID = os.environ.get("OPENIM_SENDER_ID", "imAdmin")


def send_msg(send_id, group_id, text, recv_id=None, sender_nickname="AI助手"):
    """发一条文本消息。send_id 用系统账号或指定用户。"""
    _configure()
    session_type = 3 if group_id else 1  # 3=群聊 1=单聊
    payload = {
        "sendID": send_id or SENDER_ID or "imAdmin",
        "groupID": group_id or "",
        "recvID": recv_id or "",
        "senderNickname": sender_nickname,
        "senderFaceURL": "",
        "senderPlatformID": 10,
        "content": {"content": text},          # 文本消息
        "contentType": 101,
        "sessionType": session_type,
        "isOnlineOnly": False,
        "notOfflinePush": False,
        "sendTime": int(time.time() * 1000),
        "offlinePushInfo": {"title": "AI 助手", "desc": text[:50]},
    }
    req = urllib.request.Request(
        f"{API_ADDRESS}/msg/send_msg",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "operationID": uuid.uuid4().hex,
            "token": ADMIN_TOKEN,
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def send_group_notice(group_id, text, send_id=None):
    """群里发通知/确认卡。"""
    return send_msg(send_id, group_id, text)


def send_private_confirm(group_id, user_id, text, send_id=None):
    """私聊发送者做消歧确认（低打扰）。"""
    return send_msg(send_id, "", text, recv_id=user_id)


def send_confirm_card(recv_id, card_json, group_id=None, send_id=None):
    """发送 AI 确认卡（文本消息，content 为确认卡 JSON）。
    recv_id：单聊接收者 userID；group_id：群聊目标（二选一）。
    """
    return send_msg(send_id, group_id, card_json, recv_id=recv_id or None)
