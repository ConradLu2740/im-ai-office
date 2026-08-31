# B4 历史消息挖掘 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 本地 message 表按会话分批喂 LLM 提取 术语/别名/遗漏任务 三类候选 → 待人工确认池 → 接受才入库（term source='mined' / person+alias / pending_confirmation 任务）。

**Architecture:** 新表 `mine_candidate`（双方言 JSON 存 TEXT）；新服务 `imai/services/mine.py`（分批拉消息→llm.py 锚点→落候选，接受分发）；新路由 `routes_mine.py`；前端记忆页加挖掘区。

**Tech Stack:** FastAPI + Pydantic、双方言 SQL（照抄 minutes 表先例）、llm.get_llm（json_mode）、原生 JS、pytest。

**Spec:** `docs/specs/B4历史挖掘Spec.md`

---

### Task 1: mine_candidate 表 + 提取服务（TDD）

**Files:**
- Test: `tests/guard/test_g10_mine.py`（新建）
- Modify: `imai/db.py`（POSTGRES_SCHEMA + SQLite schema 加 mine_candidate，对齐 minutes 位置）
- Create: `imai/services/mine.py`

**Step 1: 失败测试**

```python
MINE_LLM = {"terms": [{"term": "上线", "meaning": "发布到生产"}],
            "aliases": [{"real_name": "李娜", "alias": "娜姐"}],
            "tasks": [{"content": "出复盘PPT", "assignee_hint": "我", "deadline_hint": "周五前"}],
            "evidence": {"term": "以后说上线就是发布到生产", "alias": "娜姐辛苦了", "task": "我周五前出复盘PPT"}}

def test_g10_1_run_extracts_candidates(client, fake_llm, db):
    # message_add 造 10 条（conv_id="sg_mine"），含上述原文；fake_llm.route("群聊记录", **MINE_LLM)
    # POST /api/mine/run {"conv_id":"sg_mine","limit":100} → 200, by_kind {"term":1,"alias":1,"task":1}
    # 断言 term/alias/task 表零变化（term 表无"上线"，task 表无"出复盘PPT"）

def test_g10_2_duplicate_term_marked(client, fake_llm, db):
    # 先 add_term("上线","旧释义") 再 run → 该候选 status='duplicate'，pending 列表不含它
```

**Step 2:** `python -m pytest tests/guard/test_g10_mine.py -q` → FAIL（404）

**Step 3: 实现** — `mine_candidate` 双方言建表；`mine.run_mining(con, conv_id, limit, batch=100)`：
按 id 升序分批切片 → 每批 `llm.get_llm()(MINE_SYSTEM, transcript, json_mode=True)` → json.loads 失败该批跳过计数 → 逐条查重（term: `SELECT 1 FROM term WHERE term=?`；alias: `SELECT 1 FROM alias a JOIN person p ON a.person_id=p.id WHERE p.real_name=? AND a.name=?`）→ 重复置 duplicate，其余 INSERT pending（payload/evidence json.dumps）→ audit `mine_run`。返回 `{"total": n, "skipped_batches": k, "by_kind": {...}, "candidates": [...]}`。

**Step 4:** G10 前 2 例绿 → **Commit** — `feat: mine_candidate 表 + 分批提取服务（候选池，零直接入库）`

### Task 2: 候选列表 + 决定端点（TDD）

**Files:**
- Test: `tests/guard/test_g10_mine.py` 追加
- Modify: `imai/services/mine.py`（list_candidates / decide_candidate）
- Create: `imai/api/routes_mine.py` + `imai/api/__init__.py` include_router

**Step 1: 失败测试**

```python
def test_g10_3_accept_routes_by_kind(client, fake_llm, db):
    # run 后分别 accept 三类候选：
    # term → term 表有且 source='mined'；alias → person(real_name=李娜) 存在 + alias 落库；
    # task → 任务 status='pending_confirmation'，看板可见
def test_g10_4_reject_and_guard(client, fake_llm, db):
    # reject → status='rejected' + audit；对已 accepted 再 decide → 400
```

**Step 2:** 测试 → FAIL

**Step 3: 实现** — `decide_candidate(con, cid, action)`：非 pending → ValueError('already_decided')；
accept+kind=term → `memory.add_term(con, term, meaning, source="mined")`；
accept+kind=alias → 按 real_name 查/建 person（`INSERT INTO person(real_name)`，PG 用 RETURNING 兼容写法参考 repos 既有翻译层先例）→ `insert_alias_if_absent`；
accept+kind=task → `insert_task(..., status='pending_confirmation', ...)`；
均 UPDATE candidate status/decided_at/decided_by + audit。路由校验 limit 1~2000、batch ≤500、action 白名单，错误对齐 B2 风格（400/404/502）。

**Step 4:** G10 全绿 → **Commit** — `feat: 挖掘候选列表/接受/拒绝端点（term/alias/task 分发入库 + audit）`

### Task 3: 前端记忆页挖掘区（desktop/web 同步）

**Files:**
- Modify: `desktop/src/index.html`（记忆页加挖掘区块：会话选择 + 跑挖掘按钮 + 候选列表）
- Modify: `desktop/src/app.js`（loadMineCandidates / runMining / decideCandidate，事件委托 + toast 反馈，照抄审批页模式）

**Step 1:** 实现（复用 /gw/conversations 会话下拉与 B2 纪要页交互模式；候选行显示 kind 徽标 + payload 摘要 + evidence 原文 + 接受/拒绝按钮）
**Step 2:** `cp desktop/src/app.js web/ && cp desktop/src/index.html web/`（或经 dev.ps1 watcher）→ 浏览器预览截图验证：跑挖掘出候选、接受后术语出现在记忆列表
**Step 3: Commit** — `feat: 记忆页历史挖掘 UI（跑挖掘/候选列表/接受拒绝，desktop+web）`

### Task 4: 回归 + 收官

**Step 1:** `powershell -File scripts\test-env.ps1` guard 全绿；全量 pytest 无回归；`python scripts/acceptance.py` 12/12
**Step 2:** 真机（可选）：对真实群跑一次 limit=500，人工核对候选质量
**Step 3:** Spec 验收项勾选、README/交接文档补 `/api/mine/*`、迭代状态更新
**Step 4: Commit** — `docs: B4 历史挖掘收官`

---

**不做**（Spec §2）：确认卡/提醒外发、OpenIM 云端历史拉取、自动入库。
