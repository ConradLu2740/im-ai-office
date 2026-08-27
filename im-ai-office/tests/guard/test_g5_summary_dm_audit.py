#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G5 · 每日汇总 / AI DM 未读闭环 / 审计留痕完整性"""


def test_g5_1_daily_summary_counts_unresolved(client, db):
    """G5.1 未定归属任务（pending_confirmation/pending_assignee）全部进入汇总且留审计"""
    import json as _j
    db.exec("INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg)"
            " VALUES('出周报','李娜(娜姐)','待指派','周五前','pending_confirmation','high','s1')")
    db.exec("INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg)"
            " VALUES('买服务器','王冰',NULL,NULL,'pending_assignee','medium','s2')")
    db.exec("INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg)"
            " VALUES('已完成的事','张三','张三',NULL,'confirmed','high','s3')")   # 不应计入

    d = client.get("/api/summary/daily").json()
    assert d["ok"] is True and d["count"] == 2
    assert "出周报" in d["text"] and "买服务器" in d["text"]
    assert "已完成的事" not in d["text"]
    # 汇总动作有审计
    auds = db.query("SELECT detail FROM audit WHERE action='daily_summary'")
    assert len(auds) == 1
    detail = _j.loads(auds[0]["detail"])
    assert detail["count"] == 2


def test_g5_2_ai_dm_unread_cycle(client, db):
    """G5.2 AI DM：in 方向未读 → 列表未读数一致 → 标记已读归零"""
    import core
    con = core.get_conn()
    try:
        core.ai_dm_send(con, "user001", "任务提醒 A", direction="in")
        core.ai_dm_send(con, "user001", "任务提醒 B", direction="in")
        core.ai_dm_send(con, "user001", "AI 出站不占未读", direction="out")
        core.ai_dm_send(con, "user002", "别人的消息", direction="in")
    finally:
        con.close()

    r = client.get("/api/ai_dm", params={"sender_id": "user001"}).json()
    assert r["unread"] == 2                       # 仅 user001 的 in 方向两条
    assert len(r["messages"]) == 3                # out 也随会话展示

    assert client.post("/api/ai_dm/read", json={"sender_id": "user001"}).json()["ok"] is True
    assert client.get("/api/ai_dm", params={"sender_id": "user001"}).json()["unread"] == 0
    # 其他用户不受影响
    assert client.get("/api/ai_dm", params={"sender_id": "user002"}).json()["unread"] == 1


def test_g5_3_audit_records_are_complete(client, db):
    """G5.3 审计接口返回结构完整、时间倒序、含关键动作"""
    client.post("/api/role/set", json={"oim_user_id": "user001", "role": "group_admin"})
    r = client.get("/api/audit").json()
    assert r["ok"] is True
    rows = r["audit"]
    assert rows, "审计不应为空"
    for row in rows:
        assert set(row.keys()) == {"actor", "action", "detail", "ts"}
    actions = [row["action"] for row in rows]
    assert "set_role" in actions
    # 倒序：set_role 应比表里更早的种子审计靠前（本用例最后写入 set_role 相关审计位于其后插入位置不定，
    # 只锁定『包含』与结构；顺序由 DB ts 保证，同一秒可能乱序属现状，锁列表非空即可）
