# -*- coding: utf-8 -*-
"""G10 · B4 历史消息挖掘守卫用例（Spec：B4历史挖掘Spec.md）"""
CONV = "sg_mine"

# 种子消息（fake_llm 按『用户文本包含路由键』命中，路由键选 "上线就是"）
MSGS = [
    ("张伟", "各位好，项目排期同步一下"),
    ("李娜", "娜姐辛苦了，帮我盯下回归"),      # seeded alias 娜姐 已存在，不重复入池
    ("张伟", "以后说上线就是发布到生产哈"),      # 术语
    ("李娜", "老王明天把报告发群里"),           # 别名：王强=老王
    ("张伟", "出复盘PPT这事别忘了"),            # 任务
    ("李娜", "好的收到"),
]


def _seed(db, n_extra=0):
    for i, (sender, content) in enumerate(MSGS):
        db.exec("INSERT INTO message(conv_id, sender_id, sender_name, content, is_self) "
                "VALUES(?,?,?,?,0)", (CONV, sender, sender, content))
    for i in range(n_extra):
        db.exec("INSERT INTO message(conv_id, sender_id, sender_name, content, is_self) "
                "VALUES(?,?,?,?,0)", (CONV, "张伟", "张伟", f"补充消息{i}"))


MINE_LLM = {
    "terms": [{"term": "上线", "meaning": "发布到生产"}],
    "aliases": [{"real_name": "王强", "alias": "老王"}],
    "tasks": [{"content": "出复盘PPT", "assignee_hint": "张伟", "deadline_hint": None}],
    "evidence": {"term": "以后说上线就是发布到生产哈",
                 "alias": "老王明天把报告发群里",
                 "task": "出复盘PPT这事别忘了"},
}


def test_g10_1_run_extracts_candidates(client, fake_llm, db):
    """挖掘 → 三类候选进池，term/alias/task 零直接入库"""
    _seed(db)
    fake_llm.route("上线就是", **MINE_LLM)
    r = client.post("/api/mine/run", json={"conv_id": CONV, "limit": 100})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["by_kind"] == {"term": 1, "alias": 1, "task": 1}
    # 零直接入库
    assert db.query("SELECT COUNT(*) AS n FROM term WHERE term='上线'")[0]["n"] == 0
    assert db.query("SELECT COUNT(*) AS n FROM alias WHERE name='老王'")[0]["n"] == 0
    assert db.query("SELECT COUNT(*) AS n FROM task WHERE content='出复盘PPT'")[0]["n"] == 0
    # 候选池 3 条 pending，payload 是对象
    cands = client.get("/api/mine/candidates").json()["candidates"]
    assert len(cands) == 3 and all(c["status"] == "pending" for c in cands)
    assert any(c["payload"]["term"] == "上线" for c in cands if c["kind"] == "term")
    # audit
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='mine_run'")[0]["n"] == 1


def test_g10_2_duplicate_term_marked(client, fake_llm, db):
    """已存在术语 → 候选直接置 duplicate，pending 不含它"""
    _seed(db)
    db.exec("INSERT INTO term(term, meaning, source) VALUES('上线','旧释义','manual')")
    fake_llm.route("上线就是", **MINE_LLM)
    r = client.post("/api/mine/run", json={"conv_id": CONV})
    assert r.status_code == 200, r.text
    cands = client.get("/api/mine/candidates").json()["candidates"]
    assert not any(c["kind"] == "term" for c in cands)          # pending 里没有 term
    dup = client.get("/api/mine/candidates?status=duplicate").json()["candidates"]
    assert any(c["payload"]["term"] == "上线" for c in dup)


def test_g10_3_accept_routes_by_kind(client, fake_llm, db):
    """accept 按 kind 分发：term source=mined / person+alias / pending_confirmation 任务"""
    _seed(db)
    fake_llm.route("上线就是", **MINE_LLM)
    client.post("/api/mine/run", json={"conv_id": CONV})
    cands = client.get("/api/mine/candidates").json()["candidates"]
    by_kind = {c["kind"]: c for c in cands}
    for kind, cand in by_kind.items():
        r = client.post(f"/api/mine/candidates/{cand['id']}/decide", json={"action": "accept"})
        assert r.status_code == 200, r.text
    assert db.query("SELECT source FROM term WHERE term='上线'")[0]["source"] == "mined"
    assert db.query("SELECT COUNT(*) AS n FROM person WHERE real_name='王强'")[0]["n"] == 1
    assert db.query("SELECT COUNT(*) AS n FROM alias WHERE name='老王'")[0]["n"] == 1
    tasks = client.get("/api/tasks").json()["tasks"]
    t = [x for x in tasks if x["content"] == "出复盘PPT"]
    assert t and t[0]["status"] == "pending_confirmation"
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='mine_accepted'")[0]["n"] == 3


def test_g10_4_reject_and_guards(client, fake_llm, db):
    """reject 留痕；已决候选再 decide → 400；空会话 400；非法 action 400"""
    _seed(db)
    fake_llm.route("上线就是", **MINE_LLM)
    client.post("/api/mine/run", json={"conv_id": CONV})
    cands = client.get("/api/mine/candidates").json()["candidates"]
    cid = cands[0]["id"]
    assert client.post(f"/api/mine/candidates/{cid}/decide",
                       json={"action": "reject"}).status_code == 200
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='mine_rejected'")[0]["n"] == 1
    assert client.post(f"/api/mine/candidates/{cid}/decide",
                       json={"action": "accept"}).status_code == 400
    assert client.post("/api/mine/run", json={"conv_id": "sg_empty"}).status_code == 400
    assert client.post(f"/api/mine/candidates/{cid}/decide",
                       json={"action": "delete"}).status_code == 400
    assert client.get("/api/mine/candidates/999999/decide" if False else
                      "/api/mine/candidates").status_code == 200
