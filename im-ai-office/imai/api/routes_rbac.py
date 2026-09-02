#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""RBAC 路由（自旧 app.py 1:1 迁移）：角色 / 审批 / 群通知审批"""
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from imai.api import deps

from imai.db import get_conn
from imai.integrations import openim_client
from imai.services import rbac as rbac_svc

router = APIRouter()


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


@router.post("/api/role/set")
def role_set(body: RoleIn, request: Request):
    """管理员设置用户角色（member / group_admin）。需管理令牌（若启用）。"""
    denied = deps.check_admin(request)
    if denied:
        return denied
    con = get_conn()
    try:
        rbac_svc.set_role(con, body.oim_user_id, body.role)
        return {"ok": True, "role": rbac_svc.get_role(con, body.oim_user_id)}
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    finally:
        con.close()


@router.get("/api/roles")
def roles_list():
    """M3 前端可视化：角色全量列表（只读，不设防；写仍走 check_admin）。"""
    con = get_conn()
    try:
        return {"ok": True, "roles": rbac_svc.list_roles(con), "imAdmin": "group_admin"}
    finally:
        con.close()


@router.get("/api/role/{oim_user_id}")
def role_get(oim_user_id: str):
    con = get_conn()
    try:
        return {"ok": True, "role": rbac_svc.get_role(con, oim_user_id)}
    finally:
        con.close()


@router.get("/api/approvals")
def approvals(status: Optional[str] = "pending"):
    con = get_conn()
    try:
        return {"ok": True, "approvals": rbac_svc.list_approvals(con, status)}
    finally:
        con.close()


@router.post("/api/approvals/{approval_id}/decide")
def approval_decide(approval_id: int, body: ApprovalIn, request: Request):
    denied = deps.check_admin(request)
    if denied:
        return denied
    con = get_conn()
    try:
        row, detail = rbac_svc.decide_approval(con, approval_id, body.approved, body.decided_by or "group_admin")
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


@router.post("/api/notify/request")
def notify_request(body: NotifyIn):
    """AI 主动群通知：高风险动作，落待审批，不直接发。"""
    con = get_conn()
    try:
        ok, why = rbac_svc.can_do(con, body.actor, "assign_notify")
        if ok and why.startswith("admin"):
            # 管理员直接执行
            openim_client.send_group_notice(body.group_id, body.text)
            return {"ok": True, "direct": True}
        approval_id = rbac_svc.require_approval(con, body.actor, "notify_group",
                                                {"group_id": body.group_id, "text": body.text})
        return {"ok": True, "direct": False, "approvalId": approval_id, "status": "pending"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        con.close()
