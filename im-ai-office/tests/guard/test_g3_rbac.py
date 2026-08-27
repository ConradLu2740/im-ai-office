#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G3 · RBAC 角色读写 / 高风险审批闭环 / 权限矩阵"""
import json as _j


def test_g3_1_role_roundtrip(client):
    """G3.1 角色设置与读取往返；非法角色被拒"""
    r = client.post("/api/role/set", json={"oim_user_id": "user001", "role": "group_admin"}).json()
    assert r["ok"] is True and r["role"] == "group_admin"
    assert client.get("/api/role/user001").json()["role"] == "group_admin"
    # 非法值
    bad = client.post("/api/role/set", json={"oim_user_id": "user001", "role": "superadmin"}).json()
    assert bad["ok"] is False and "invalid role" in bad["error"]
    # 默认角色 member（无记录时兜底）
    assert client.get("/api/role/nobody").json()["role"] == "member"


def test_g3_2_high_risk_needs_approval(client, db):
    """G3.2 member 触发高风险群通知 → 落 pending 审批、动作不执行"""
    r = client.post("/api/notify/request",
                    json={"group_id": "sg_001", "text": "今晚 8 点发布", "actor": "sim_user"}).json()
    assert r["ok"] is True and r["direct"] is False
    assert r["status"] == "pending" and r["approvalId"] > 0
    # 审批表一条 pending；OpenIM 发送未被触发（stub 收集器为空）
    rows = db.query("SELECT * FROM approval WHERE id=?", (r["approvalId"],))
    assert rows[0]["status"] == "pending" and rows[0]["action"] == "notify_group"
    assert client.openim_sends.sent_group == []
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='approval_pending'")[0]["n"] >= 1


def test_g3_3_approval_decide_and_execute(client, db):
    """G3.3 admin 批复 → 状态 approved + decided_by/decided_at 回填 + 代发动作执行"""
    aid = client.post("/api/notify/request",
                      json={"group_id": "sg_001", "text": "今晚 8 点发布",
                            "actor": "sim_user"}).json()["approvalId"]
    r = client.post(f"/api/approvals/{aid}/decide",
                    json={"approved": True, "decided_by": "imAdmin"}).json()
    assert r["ok"] is True
    row = r["approval"]
    assert row["status"] == "approved" and row["decided_by"] == "imAdmin"
    assert row["decided_at"]
    # 批准后代发动作真实发生（stub 收集）
    assert any(s["text"] == "今晚 8 点发布" for s in client.openim_sends.sent_group)
    # 审计可查
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='approval_approved'")[0]["n"] >= 1


def test_g3_3b_reject_decision(client, db):
    """G3.3b 驳回审批 → rejected、本次代发不发生"""
    before = len(client.openim_sends.sent_group)   # 会话级收集器，与用例序无关
    aid = client.post("/api/notify/request",
                      json={"group_id": "sg_002", "text": "外发草稿", "actor": "sim_user"}).json()["approvalId"]
    r = client.post(f"/api/approvals/{aid}/decide",
                    json={"approved": False, "decided_by": "imAdmin"}).json()
    assert r["ok"] is True and r["approval"]["status"] == "rejected"
    assert len(client.openim_sends.sent_group) == before
    assert any(s["text"] != "外发草稿" for s in client.openim_sends.sent_group)
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='approval_rejected'")[0]["n"] >= 1


def test_g3_4_can_do_matrix():
    """G3.4 can_do 矩阵抽查（core 层语义）：member 高风险一律待批，admin 直接放行"""
    import core
    con = core.get_conn()
    try:
        member_allows = []
        admin_allows = []
        ok, why = core.can_do(con, "u1", "assign_notify")       # member（默认）
        member_allows.append((ok, why))
        ok2, why2 = core.can_do(con, "imAdmin", "assign_notify")
        admin_allows.append((ok2, why2))
        assert member_allows == [(False, "require_approval")]
        assert admin_allows == [(True, "admin 允许，直接执行")]
        # 通用读写在两级都允许
        for uid in ("u1", "imAdmin"):
            for act in ("read_group", "write_board"):
                okx, _ = core.can_do(con, uid, act)
                assert okx is True
    finally:
        con.close()


def test_g3_5_approvals_list_filter(client, db):
    """G3.5 审批列表按状态过滤"""
    client.post("/api/notify/request",
                json={"group_id": "sg_001", "text": "A", "actor": "sim_user"})
    pend = client.get("/api/approvals", params={"status": "pending"}).json()["approvals"]
    assert len(pend) == 1 and pend[0]["status"] == "pending"
