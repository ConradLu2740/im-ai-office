#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M3 RBAC 服务（自 core.py:75-163 1:1 迁移）：角色判定 + 高风险审批 + 审计留痕"""
import json

from imai.config import HIGH_RISK_ACTIONS
from imai.db import take_id
from imai.repos import audit_log


def get_role(con, oim_user_id):
    """返回用户角色，查不到默认 member；imAdmin 视为 group_admin。"""
    c = con.cursor()
    if oim_user_id == "imAdmin":
        return "group_admin"
    c.execute("SELECT role FROM role WHERE oim_user_id=?", (oim_user_id,))
    row = c.fetchone()
    return (row["role"] if row else "member")


def set_role(con, oim_user_id, role):
    """设置/更新用户角色。"""
    valid = {"member", "group_admin"}
    if role not in valid:
        raise ValueError(f"invalid role: {role}")
    c = con.cursor()
    c.execute("INSERT INTO role(oim_user_id, role) VALUES(?,?) "
              "ON CONFLICT(oim_user_id) DO UPDATE SET role=excluded.role, updated_at=datetime('now')",
              (oim_user_id, role))
    con.commit()
    audit_log(con, "system", "set_role", {"oim_user_id": oim_user_id, "role": role})


def can_do(con, oim_user_id, action, role=None):
    """返回 (允许, 说明)。action ∈ read_group/write_board/...及高风险项。
    AI 角色 ai-group-assistant: 读群必须、写看板记审计、高风险 require_approval。"""
    role = role or get_role(con, oim_user_id)
    if action in HIGH_RISK_ACTIONS:
        if role == "group_admin":
            return True, "admin 允许，直接执行"
        return False, "require_approval"   # 高风险：一律先人工批准
    if action == "read_group":
        return True, "读群允许"
    if action == "write_board":
        return True, "写看板允许"
    return True, "default allow"


def require_approval(con, actor, action, detail=None):
    """插入一条待审批准。返回 approval id。AI 不直接执行高风险动作，只落审批。"""
    c = con.cursor()
    c.execute("INSERT INTO approval(actor,action,detail,status) VALUES(?,?,?,'pending') RETURNING id",
              (actor, action, json.dumps(detail, ensure_ascii=False) if detail is not None else None))
    _id = take_id(c)
    con.commit()
    audit_log(con, actor, "approval_pending", {"approvalId": _id, "action": action, "detail": detail})
    return _id


def list_approvals(con, status="pending"):
    """列出待审批/已处理审批。"""
    c = con.cursor()
    if status:
        c.execute("SELECT * FROM approval WHERE status=? ORDER BY id DESC", (status,))
    else:
        c.execute("SELECT * FROM approval ORDER BY id DESC")
    cols = [d[0] for d in c.description]
    return [dict(zip(cols, r)) for r in c.fetchall()]


def decide_approval(con, approval_id, approved, decided_by):
    """人工批复：批准则返回 detail(dict) 供后续执行；拒绝则标记 rejected。"""
    status = "approved" if approved else "rejected"
    c = con.cursor()
    c.execute("UPDATE approval SET status=?, decided_at=datetime('now'), decided_by=? WHERE id=?",
              (status, decided_by, approval_id))
    con.commit()
    audit_log(con, f"user:{decided_by}", "approval_approved" if approved else "approval_rejected",
              {"approvalId": approval_id})
    c.execute("SELECT * FROM approval WHERE id=?", (approval_id,))
    row = c.fetchone()
    if not row:
        return None, None
    cols = [d[0] for d in c.description]
    r = dict(zip(cols, row))
    detail = json.loads(r["detail"]) if r.get("detail") else None
    return r, detail
