#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G2 · 归属消歧 / 私聊确认（别名索引 → 歧义私聊 → 数字/姓名回复收敛）"""
from tests.helpers import make_intent

AMBIG_MSG = "让小张跟进一下供应商比价"          # 种子数据：小张→张伟(产品)+张敏(市场)，天然双命中
SELF_MSG = "这次618复盘我来出物料清单，下周三前"
UNOWNED_MSG = "这周得把方案发出去"
SINGLE_HIT_MSG = "让张敏对接一下设计稿"


def _amb_intent():
    return make_intent("跟进供应商比价", confidence="medium",
                       assignee_hint="小张", assign_mode="third_party")


def test_g2_1_ambiguous_creates_private_confirm(client, fake_llm, db):
    """G2.1 双命中『小张』→ pending_assignee + 私聊出站 + 审计，不弹群确认卡"""
    fake_llm.route(AMBIG_MSG, **_amb_intent())
    d = client.post("/api/simulate_message", json={"sender": "李娜(娜姐)", "text": AMBIG_MSG}).json()

    ai = d["ai"]
    assert ai["action"] == "confirm_assignee"
    t = ai["task"]
    assert t["status"] == "pending_assignee"
    labels = [c["label"] for c in t["candidates"]]
    assert sorted(labels) == ["张伟(小张)", "张敏(小张)"], "候选列表与顺序需稳定"

    # 私聊出站：simulate 路径仅写入 ai_dm 会话库；OpenIM HTTP 推送仅存在于
    # /callback 链路（由 test_g2_5 单聊回调 + stub 收集器覆盖），此处不应有网络调用。
    dms = db.query("SELECT * FROM ai_dm WHERE direction='out'")
    assert len(dms) >= 1 and dms[-1]["task_id"] == t["taskId"]
    # 审计留痕
    amb = db.query("SELECT detail FROM audit WHERE action='identify_ambiguous'")
    assert len(amb) == 1
    assert db.query("SELECT status FROM task WHERE id=?", (t["taskId"],))[0]["status"] == "pending_assignee"


def test_g2_2_resolve_by_choice_number(client, fake_llm, db):
    """G2.2a 数字回复选人 → 直接 confirmed + pending_meta 清空 + ai_dm 回写"""
    fake_llm.route(AMBIG_MSG, **_amb_intent())
    sim = client.post("/api/simulate_message",
                      json={"sender": "李娜(娜姐)", "text": AMBIG_MSG}).json()
    tid = sim["ai"]["task"]["taskId"]

    r = client.post("/api/tasks/resolve",
                    json={"sender_id": "sim_user", "choice": "1"}).json()
    assert r["ok"] is True and r["action"] == "confirmed"
    assert r["assignee"] == "张伟(小张)" and r["taskId"] == tid

    row = db.query("SELECT * FROM task WHERE id=?", (tid,))[0]
    assert row["status"] == "confirmed" and row["pending_meta"] is None
    # resolve 成功后 API 会写一条 in 方向回执
    ins = db.query("SELECT * FROM ai_dm WHERE direction='in' AND task_id=?", (tid,))
    assert any("已确认负责人" in m["content"] for m in ins)


def test_g2_2b_resolve_invalid_choice(client, fake_llm):
    """G2.2b 越界数字 → invalid_choice 且回显候选（文案格式锁定）"""
    fake_llm.route(AMBIG_MSG, **_amb_intent())
    client.post("/api/simulate_message", json={"sender": "李娜(娜姐)", "text": AMBIG_MSG})

    r = client.post("/api/tasks/resolve",
                    json={"sender_id": "sim_user", "choice": "9"}).json()
    assert r["ok"] is False and r["error"] == "invalid_choice"
    assert r["candidates"][0].startswith("1. 张伟(小张)")
    assert r["candidates"][1].startswith("2. 张敏(小张)")


def test_g2_3_unowned_task_no_dm(client, fake_llm, db):
    """G2.3 无人认领 → 待指派入库、不触发私聊"""
    fake_llm.route(UNOWNED_MSG, **make_intent("把方案发出去", confidence="low",
                                              assignee_hint=None, deadline_hint="这周内",
                                              assign_mode="none"))
    before_privates = len(client.openim_sends.sent_private)
    before_dm = db.query("SELECT COUNT(*) AS n FROM ai_dm")[0]["n"]
    d = client.post("/api/simulate_message", json={"sender": "李娜(娜姐)", "text": UNOWNED_MSG}).json()

    assert d["ai"]["action"] == "task_created"
    t = d["ai"]["task"]
    assert t["assignee"] == "待指派"          # None → 『待指派』文案兜底（process_message:408）
    assert t["status"] == "pending_confirmation"
    after_dm = db.query("SELECT COUNT(*) AS n FROM ai_dm")[0]["n"]
    assert after_dm == before_dm and len(client.openim_sends.sent_private) == before_privates


def test_g2_4_single_alias_hit_direct(client, fake_llm, db):
    """G2.4 单一别名命中 → 不歧义，直接进确认流（assignee 为拼接串，现状锁定）"""
    fake_llm.route(SINGLE_HIT_MSG, **make_intent("对接设计稿", confidence="medium",
                                                 assignee_hint="张敏", assign_mode="third_party"))
    d = client.post("/api/simulate_message", json={"sender": "李娜(娜姐)", "text": SINGLE_HIT_MSG}).json()
    ai = d["ai"]
    assert ai["action"] == "task_created"
    assert ai["task"]["status"] == "pending_confirmation"
    # 单命中时 assignee = real_name/flower_name 拼接串（core.resolve:385 现状锁定）
    assert ai["task"]["assignee"] == "张敏/小张"
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='identify_ambiguous'")[0]["n"] == 0


def test_g2_5_single_chat_callback_reply_confirms(client, fake_llm, db):
    """G2.5 单聊回调回复数字 → resolve_assignee_reply 收敛为 confirmed。
    【现状缺陷记录】handle_openim_callback 只在 action=='assigned' 时执行告知分支，
    而 resolve_assignee_reply 返回 'confirmed'——该分支当前不可达（死代码），流程仍闭环，
    记录给后续修复；本用例锁定的是实际可达路径的返回结构。"""
    fake_llm.route(AMBIG_MSG, **_amb_intent())
    sender = "李娜(娜姐)"
    gid = "sg_callback_test"
    # 1) 群消息回调产生歧义任务
    cb1 = client.post("/callback", json={
        "msgID": "cb-m1", "groupID": gid, "sendID": "user001",
        "senderNickname": sender, "contentType": "101", "content": AMBIG_MSG,
    }).json()
    assert cb1["handled"] is False or cb1["action"] in ("confirm_assignee_sent", "confirm_assignee")
    task = db.query("SELECT * FROM task WHERE status='pending_assignee' ORDER BY id DESC LIMIT 1")[0]

    # 2) 同发送者单聊回复『2』选张敏
    cb2 = client.post("/callback", json={
        "msgID": "cb-m2", "recvID": "imai_assistant", "sendID": "user001",
        "senderNickname": sender, "contentType": "101", "content": "2",
    }).json()
    result = cb2["result"]
    assert result["ok"] is True and result["action"] == "confirmed"
    assert result["taskId"] == task["id"]
    assert result["assignee"] == "张敏(小张)"

    row = db.query("SELECT * FROM task WHERE id=?", (task["id"],))[0]
    assert row["status"] == "confirmed" and row["pending_meta"] is None
