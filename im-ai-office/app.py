#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对话式 AI 办公 · MVP 本地可交互服务（FastAPI）

启动： uvicorn app:app --host 127.0.0.1 --port 8000
浏览器打开 http://127.0.0.1:8000 即可交互体验完整闭环。
"""
import json
import os
from pathlib import Path
from typing import Optional
import urllib.request
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

# 优先加载 .env
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:
    pass

import core
import openim_client

app = FastAPI(title="对话式 AI 办公 · MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INDEX = Path(__file__).parent / "index.html"

# 启动时初始化数据库
with core.get_conn() as con:
    core.init_db()



class ChatIn(BaseModel):
    message: str
    sender: str = "李娜(娜姐)"


class ConfirmIn(BaseModel):
    assignee: Optional[str] = None
    deadline: Optional[str] = None


class RejectIn(BaseModel):
    reason: str = ""


# ============ OpenIM 回调接入 ============

OPENIM_API = os.environ.get("OPENIM_API", "http://127.0.0.1:10002")
OPENIM_ADMIN_TOKEN = os.environ.get("OPENIM_ADMIN_TOKEN", "")
OPENIM_SECRET = os.environ.get("OPENIM_SECRET", "openIM123")


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


@app.post("/openim/login")
def openim_login(body: dict):
    """用户登录：用 userID 换取用户 token。"""
    user_id = body.get("user_id", "").strip()
    if not user_id:
        return {"ok": False, "error": "user_id 不能为空"}
    try:
        data = _openim_post("/auth/get_user_token", {
            "secret": OPENIM_SECRET,
            "platformID": 5,
            "userID": user_id,
        }, token=OPENIM_ADMIN_TOKEN)
        if data.get("errCode") == 0:
            token = data["data"]["token"]
            return {"ok": True, "token": token, "user_id": user_id}
        return {"ok": False, "error": data.get("errMsg", "login failed")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/openim/conversations")
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


@app.post("/openim/send_message")
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
            con = core.get_conn()
            try:
                core.message_add(con, conv_id, user_id, sender_name, text, is_self=1, msg_seq=data["data"].get("seq"), client_msg_id=data["data"].get("serverMsgID", ""))
            finally:
                con.close()
            # 发送成功后，同步做 AI 识别（不依赖 OpenIM 回调，双保险）
            ai_result = core.process_message(text, sender_name)
            # 歧义时：写 AI 助手会话 + 发 OpenIM 私聊确认
            if ai_result.get("action") == "confirm_assignee":
                task = ai_result.get("task", {})
                confirm_text = _build_confirm_text(task)
                con = core.get_conn()
                try:
                    core.ai_dm_send(con, user_id, confirm_text, task_id=task.get("taskId"), direction="out")
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


@app.post("/openim/get_messages")
def openim_get_messages(body: dict):
    """获取会话历史消息（简化：先返回空，后续用 WebSocket/轮询补齐）。"""
    return {"ok": True, "messages": []}


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


def handle_openim_callback(payload: dict):
    """处理 OpenIM afterSendGroupMsg / afterSendSingleMsg 回调。"""
    # 支持多种字段名
    msg_id = payload.get("msgID") or payload.get("msgId") or payload.get("msg_id") or ""
    grp_id = payload.get("groupID") or payload.get("group_id") or ""
    recv_id = payload.get("recvID") or payload.get("recv_id") or ""
    sender_id = payload.get("sendID") or payload.get("send_id") or ""
    sender_nickname = payload.get("senderNickname") or payload.get("sender_nickname") or sender_id
    content_type = payload.get("contentType") or payload.get("content_type") or 101
    content = _extract_text_content(payload.get("content", ""))

    if not content:
        return {"ok": True, "handled": False, "reason": "empty_content"}

    # 文本消息才处理
    if int(content_type) != 101:
        return {"ok": True, "handled": False, "reason": "not_text"}

    # 群消息：AI 旁听并识别任务
    if grp_id:
        result = core.process_message(content, sender_nickname, group_id=grp_id)
        if result.get("action") == "confirm_assignee":
            task = result.get("task", {})
            # M4-S6 溯源：命中团队记忆则标注依据
            con_proof = core.get_conn()
            try:
                task["proofs"] = core.memory_proofs(con_proof, task.get("content") or content)
            finally:
                con_proof.close()
            # 私聊发送者确认负责人：写入 AI 助手会话 + 调 OpenIM 私聊发送
            text = _build_confirm_text(task)
            con = core.get_conn()
            try:
                core.ai_dm_send(con, sender_id, text, task_id=task.get("taskId"), direction="out")
            finally:
                con.close()
            try:
                openim_client.send_private_confirm(grp_id, sender_id, text)
            except Exception as e:
                return {"ok": False, "handled": False, "action": "confirm_assignee", "error": str(e)}
            return {"ok": True, "handled": True, "action": "confirm_assignee_sent", "taskId": task.get("taskId")}
        elif result.get("action") == "task_created":
            return {"ok": True, "handled": True, "action": "task_created", "taskId": result["task"]["taskId"]}
        else:
            return {"ok": True, "handled": False, "action": "skip"}

    # 单聊消息：处理私聊确认回复（发给 AI 助手或系统账号）
    if recv_id and not grp_id:
        # 只处理发给 AI 助手/系统账号的回复
        # 实际回调 recvID 是接收者，这里假设回复发给 openIMAdmin/imai_assistant
        con = core.get_conn()
        try:
            resolved = core.resolve_assignee_reply(con, sender_nickname, content)
            if resolved.get("ok") and resolved.get("action") == "assigned":
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


@app.post("/callback")
async def openim_callback(request: Request):
    """OpenIM 消息回调入口。"""
    body = await request.body()
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return {"ok": False, "error": "invalid json"}
    return handle_openim_callback(payload)


@app.post("/api/chat")
def chat(body: ChatIn):
    """提交一条群消息，跑完整识别/归属/落库链路，返回判定结果。"""
    result = core.process_message(body.message, body.sender)
    result["events"] = core.EVENTS[-3:]  # 最近事件（演示透出）
    return result


@app.get("/api/tasks")
def tasks(status: Optional[str] = None):
    con = core.get_conn()
    rows = core.list_tasks(con, status)
    # M4-S6 溯源：任务命中团队记忆则附依据
    for row in rows:
        row["proofs"] = core.memory_proofs(con, row.get("content") or row.get("source_msg") or "")
    con.close()
    return {"tasks": rows, "events": core.EVENTS[-5:]}


@app.post("/api/simulate_message")
def simulate_message(body: dict):
    """模拟一条群消息（不依赖 OpenIM），触发 AI 识别 + 入库 + 显示。"""
    sender = body.get("sender", "同事")
    text = body.get("text", "")
    conv_id = body.get("conv_id", "sg_simulated")
    if not text:
        return {"ok": False, "error": "text 不能为空"}
    # 入库（作为别人的消息 is_self=0）
    con = core.get_conn()
    try:
        core.message_add(con, conv_id, "sim_user", sender, text, is_self=0)
    finally:
        con.close()
    # AI 识别
    ai_result = core.process_message(text, sender)
    # 歧义时：写 AI 助手会话
    if ai_result.get("action") == "confirm_assignee":
        task = ai_result.get("task", {})
        confirm_text = _build_confirm_text(task)
        con = core.get_conn()
        try:
            core.ai_dm_send(con, "sim_user", confirm_text, task_id=task.get("taskId"), direction="out")
        finally:
            con.close()
    return {"ok": True, "ai": ai_result, "message": ai_result.get("message", text)}


@app.post("/api/sdk_message")
def sdk_message(body: dict):
    """SDK 收到的 OpenIM 实时消息：AI 识别 + 入库 + 显示。"""
    sender = body.get("sender", "同事")
    text = body.get("text", "")
    conv_id = body.get("conv_id", "sg_sdk")
    send_id = body.get("send_id", "")
    if not text:
        return {"ok": False, "error": "text 不能为空"}
    # 入库（收到的消息 is_self=0）
    con = core.get_conn()
    try:
        core.message_add(con, conv_id, send_id or "sdk_user", sender, text, is_self=0)
    finally:
        con.close()
    # AI 识别
    ai_result = core.process_message(text, sender)
    # 歧义时：写 AI 助手会话
    if ai_result.get("action") == "confirm_assignee":
        task = ai_result.get("task", {})
        confirm_text = _build_confirm_text(task)
        con = core.get_conn()
        try:
            core.ai_dm_send(con, send_id or "sdk_user", confirm_text, task_id=task.get("taskId"), direction="out")
        finally:
            con.close()
    return {"ok": True, "ai": ai_result, "message": ai_result.get("message", text)}


@app.get("/api/messages")
def messages(conv_id: Optional[str] = None):
    con = core.get_conn()
    rows = core.message_list(con, conv_id)
    con.close()
    return {"messages": rows}


@app.post("/api/tasks/{task_id}/confirm")
def confirm(task_id: int, body: ConfirmIn = None):
    body = body or ConfirmIn()
    con = core.get_conn()
    ok = core.confirm_task(con, task_id, body.assignee, body.deadline)
    con.close()
    return {"ok": ok}


@app.post("/api/tasks/{task_id}/reject")
def reject(task_id: int, body: RejectIn = None):
    body = body or RejectIn()
    con = core.get_conn()
    ok = core.reject_task(con, task_id, body.reason)
    con.close()
    return {"ok": ok}


@app.get("/", response_class=HTMLResponse)
def index():
    html = INDEX.read_text(encoding="utf-8") if INDEX.exists() else "<h1>请创建 index.html</h1>"
    return HTMLResponse(content=html)


# ============ AI 助手私聊会话接口 ============

class ResolveIn(BaseModel):
    sender_id: str
    choice: str
    task_id: Optional[int] = None


class RoleIn(BaseModel):
    oim_user_id: str
    role: str


class ApprovalIn(BaseModel):
    approved: bool
    decided_by: Optional[str] = "group_admin"


class NotifyIn(BaseModel):
    group_id: str
    text: str
    actor: str = "ai"


class TermIn(BaseModel):
    term: str
    meaning: str


class GrpMetaIn(BaseModel):
    oim_group_id: str
    intro: Optional[str] = None
    ai_enabled: Optional[int] = None


@app.get("/api/ai_dm")
def ai_dm(sender_id: Optional[str] = None):
    con = core.get_conn()
    msgs = core.ai_dm_list(con, sender_id)
    unread = core.ai_dm_unread_count(con, sender_id)
    con.close()
    return {"messages": msgs, "unread": unread}


@app.post("/api/ai_dm/read")
def ai_dm_read(body: dict):
    con = core.get_conn()
    core.ai_dm_mark_read(con, body.get("sender_id"))
    con.close()
    return {"ok": True}


@app.post("/api/tasks/resolve")
def resolve(body: ResolveIn):
    con = core.get_conn()
    try:
        result = core.resolve_task_by_choice(con, body.sender_id, body.choice, body.task_id)
        if result.get("ok"):
            # 写入已确认回复到 ai_dm
            text = f"已确认负责人：{result.get('assignee')}"
            core.ai_dm_send(con, body.sender_id, text, task_id=result.get("taskId"), direction="in")
        return result
    finally:
        con.close()


# ============ M3 RBAC 接口 ============

@app.post("/api/role/set")
def role_set(body: RoleIn):
    """管理员设置用户角色（member / group_admin）。"""
    con = core.get_conn()
    try:
        core.set_role(con, body.oim_user_id, body.role)
        return {"ok": True, "role": core.get_role(con, body.oim_user_id)}
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    finally:
        con.close()


@app.get("/api/role/{oim_user_id}")
def role_get(oim_user_id: str):
    con = core.get_conn()
    try:
        return {"ok": True, "role": core.get_role(con, oim_user_id)}
    finally:
        con.close()


@app.get("/api/approvals")
def approvals(status: Optional[str] = "pending"):
    con = core.get_conn()
    try:
        return {"ok": True, "approvals": core.list_approvals(con, status)}
    finally:
        con.close()


@app.post("/api/approvals/{approval_id}/decide")
def approval_decide(approval_id: int, body: ApprovalIn):
    con = core.get_conn()
    try:
        row, detail = core.decide_approval(con, approval_id, body.approved, body.decided_by or "group_admin")
        if row is None:
            return {"ok": False, "error": "approval not found"}
        # 若批准且动作是群通知，则真正代发
        if body.approved and detail and row.get("action") == "notify_group":
            try:
                openim_client.send_group_notice(detail.get("group_id", ""), detail.get("text", ""))
            except Exception as e:
                return {"ok": False, "error": f"approved but send failed: {e}"}
        return {"ok": True, "approval": row}
    finally:
        con.close()


@app.post("/api/notify/request")
def notify_request(body: NotifyIn):
    """AI 主动群通知：高风险动作，落待审批，不直接发。"""
    con = core.get_conn()
    try:
        ok, why = core.can_do(con, body.actor, "assign_notify")
        if ok and why.startswith("admin"):
            # 管理员直接执行
            openim_client.send_group_notice(body.group_id, body.text)
            return {"ok": True, "direct": True}
        approval_id = core.require_approval(con, body.actor, "notify_group",
                                            {"group_id": body.group_id, "text": body.text})
        return {"ok": True, "direct": False, "approvalId": approval_id, "status": "pending"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        con.close()


@app.get("/api/audit")
def audit_list(limit: int = 30):
    con = core.get_conn()
    try:
        c = con.cursor()
        c.execute("SELECT actor,action,detail,ts FROM audit ORDER BY rowid DESC LIMIT ?", (limit,))
        cols = [d[0] for d in c.description]
        return {"ok": True, "audit": [dict(zip(cols, r)) for r in c.fetchall()]}
    finally:
        con.close()


# ============ M4 团队记忆接口 ============

@app.get("/api/terms")
def terms():  # 保留 python 内置名? 用复数 endpoint, 函数名 terms 可
    con = core.get_conn()
    try:
        return {"ok": True, "terms": core.list_terms(con)}
    finally:
        con.close()


@app.post("/api/term/add")
def term_add(body: TermIn):
    con = core.get_conn()
    try:
        core.add_term(con, body.term, body.meaning, source="manual")
        return {"ok": True, "term": body.term, "meaning": body.meaning}
    finally:
        con.close()


@app.post("/api/grp/meta")
def grp_meta_set(body: GrpMetaIn):
    con = core.get_conn()
    try:
        core.set_grp_meta(con, body.oim_group_id, intro=body.intro, ai_enabled=body.ai_enabled)
        return {"ok": True, "meta": core.get_grp_meta(con, body.oim_group_id)}
    finally:
        con.close()


@app.get("/api/grp/meta/{group_id}")
def grp_meta_get(group_id: str):
    con = core.get_conn()
    try:
        return {"ok": True, "meta": core.get_grp_meta(con, group_id)}
    finally:
        con.close()


@app.get("/api/memory")
def memory(group_id: Optional[str] = None):
    """查看团队记忆：术语 + 群简介（+ 术语溯源）。"""
    con = core.get_conn()
    try:
        return {"ok": True, "memory": {
            "terms": core.list_terms(con),
            "grp_meta": core.get_grp_meta(con, group_id) if group_id else None,
        }}
    finally:
        con.close()


@app.get("/api/summary/daily")
def summary_daily(group_id: Optional[str] = None):
    """M2 每日汇总兜底：当天未确认归属任务清单（下班前推给群主/管理员）。"""
    con = core.get_conn()
    try:
        sm = core.build_daily_summary(con, group_id)
        # 审计：汇总动作留痕
        core.audit(con, "system", "daily_summary", sm)
        return {"ok": True, **sm}
    finally:
        con.close()


def _gateway_auto_login():
    """后端启动后自动登录 OpenIM 网关：换 token → /gw/login → 轮询连接。
    失败仅记日志，不阻塞后端启动（后台线程）。"""
    import time as _time
    import threading

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
                    _time.sleep(2)
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
                _time.sleep(0.5)
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


@app.on_event("startup")
def _on_startup():
    _gateway_auto_login()


if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("IMAI_HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=8000)
