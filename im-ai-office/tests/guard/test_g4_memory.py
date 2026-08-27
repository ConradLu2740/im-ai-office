#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G4 · 团队记忆：术语/群简介维护、上下文注入、溯源、修正信号沉淀"""
import core
from tests.helpers import make_intent


def test_g4_1_term_add_and_list(client, db):
    """G4.1 新增术语 → 列表可见 + memorize 审计"""
    r = client.post("/api/term/add",
                    json={"term": "红字版", "meaning": "红色修订版"}).json()
    assert r["ok"] is True
    terms = client.get("/api/terms").json()["terms"]
    hit = [t for t in terms if t["term"] == "红字版"]
    assert len(hit) == 1
    assert hit[0]["meaning"] == "红色修订版" and hit[0]["source"] == "manual"
    audits = db.query("SELECT * FROM audit WHERE action='memorize'")
    assert any("红字版" in (a["detail"] or "") for a in audits)


def test_g4_2_context_injection(client, fake_llm, db):
    """G4.2 设置群简介+术语后，处理该群消息时 system 注入包含三者
    （注入入口现状：仅 OpenIM 回调/simulate 直调带 group_id 的 process_message）"""
    client.post("/api/grp/meta",
                json={"oim_group_id": "sg_001", "intro": "产品讨论群·X 产品评审"}).json()
    client.post("/api/term/add", json={"term": "红字版", "meaning": "红色修订版"})

    msg = "这条要用红字版发出去"
    fake_llm.route(msg, **make_intent(is_task=False))
    core.process_message(msg, "李娜(娜姐)", group_id="sg_001")

    assert fake_llm.calls, "LLM 应至少被调用一次"
    system = fake_llm.calls[-1]["system"]
    assert "【群简介】产品讨论群·X 产品评审" in system
    assert "【术语】" in system and "红字版=红色修订版" in system
    assert "【人称】" in system
    for expected in ("娜姐=李娜", "小张=张伟", "小张=张敏"):
        assert expected in system, f"人称注入缺 {expected}"


def test_g4_3_memory_proofs_traceability(client, db):
    """G4.3 溯源：文本同时命中术语与别名 → 两类依据并列返回"""
    con = core.get_conn()
    con.close()
    core.add_term(core.get_conn(), "红字版", "红色修订版")
    proofs = core.memory_proofs(core.get_conn(), "这个要用红字版发，找娜姐就行")
    kinds = {(p["type"], p["term"]) for p in proofs}
    assert ("term", "红字版") in kinds
    assert ("person", "娜姐") in kinds
    person_hit = [p for p in proofs if p["type"] == "person"][0]
    assert person_hit["source"] == "alias" and person_hit["meaning"] == "李娜"


def test_g4_4_reject_signal_deposits_term(client, fake_llm, db):
    """G4.4 驳回理由指明正确人名（库中不存在者）→ 沉淀 term 级修正信号"""
    msg = "周报整理一下"
    fake_llm.route(msg, **make_intent("整理周报", assignee_hint=None, assign_mode="none"))
    tid = client.post("/api/simulate_message", json={"sender": "测试同事", "text": msg}).json()[
        "ai"]["task"]["taskId"]

    client.post(f"/api/tasks/{tid}/reject", json={"reason": "负责人错了，应该是王小明"})
    terms = client.get("/api/terms").json()["terms"]
    hit = [t for t in terms if t["term"] == "人称:王小明"]
    assert len(hit) == 1
    assert hit[0]["source"] == "corrected"
    assert "reject 任务#{}".format(tid) in hit[0]["meaning"] or str(tid) in hit[0]["meaning"]
    # 而正确人名已在别名表的场景不重复沉淀（张敏已存在）
    fake_llm.route("表格更新一下", **make_intent("更新表格", assignee_hint=None, assign_mode="none"))
    tid2 = client.post("/api/simulate_message", json={"sender": "测试同事", "text": "表格更新一下"}).json()[
        "ai"]["task"]["taskId"]
    client.post(f"/api/tasks/{tid2}/reject", json={"reason": "负责人错了，应该是张敏"})
    terms2 = client.get("/api/terms").json()["terms"]
    assert not [t for t in terms2 if t["term"].startswith("人称:张敏")], "已在别名表的人名不应沉淀术语信号"


def test_g4_5_grp_meta_roundtrip(client):
    """G4.5 群简介与旁听开关读写"""
    r = client.post("/api/grp/meta",
                    json={"oim_group_id": "sg_009", "intro": "销售支持群", "ai_enabled": 0}).json()
    assert r["ok"] is True
    assert r["meta"]["intro"] == "销售支持群" and r["meta"]["ai_enabled"] == 0
    got = client.get("/api/grp/meta/sg_009").json()
    assert got["ok"] is True and got["meta"]["intro"] == "销售支持群"
