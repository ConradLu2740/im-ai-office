# B2 会议纪要 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 选会话 + 最近 N 条消息 → LLM 生成纪要（摘要/结论/行动项）→ 行动项一键转任务进看板确认流。

**Architecture:** 新表 `minutes`（双方言，JSON 字段存 TEXT）；新服务 `imai/services/minutes.py`（拉消息→llm_chat→落库）；新路由 `routes_minutes.py`；前端新增「纪要」面板（复用 /gw/conversations 选会话）。

**Tech Stack:** FastAPI、llm_provider.llm_chat（json_mode）、原生 JS、pytest。

**Spec:** `迭代2-Spec.md` §3

---

### Task 1: minutes 表 + 生成服务（TDD）

**Files:**
- Test: `tests/guard/test_g7_minutes.py`（新建）
- Modify: `imai/db.py`（POSTGRES_SCHEMA + SQLite schema 加 minutes 表）
- Create: `imai/services/minutes.py`

**Step 1: 失败测试**

```python
LLM_MINUTES = {"title": "618 复盘会", "summary": "对齐了复盘分工",
               "decisions": ["复盘会改为线上"],
               "action_items": [{"content": "出复盘PPT", "assignee_hint": "我", "deadline_hint": "周五前"}]}
# fake_llm.route("出复盘PPT", **LLM_MINUTES)  # 路由键按 user 文本包含匹配
# 用 repos.message_add 造 3 条消息（conv_id="sg_meeting"）
# POST /api/minutes/generate {conv_id, limit:50} → 200, 返回含 title/decisions/action_items
# GET /api/minutes?conv_id=sg_meeting → 列表含该记录；GET /api/minutes/{id} → 详情一致
# POST /api/minutes/{id}/task {index:0} → {ok, taskId}，/api/tasks 出现 pending_confirmation 任务
# 错误分支：generate 空会话 400；task index=9 400；minutes/{id}=999999 404
```

**Step 2:** `python -m pytest tests/guard/test_g7_minutes.py -q` → FAIL（404 路由不存在）

**Step 3: 实现**

- db.py 两处 schema 追加（PG 用 TEXT 存 JSON；SQLite 同构）：
  `minutes(id BIGSERIAL PK, conv_id TEXT, title TEXT, summary TEXT, decisions TEXT, action_items TEXT, msg_count INTEGER, created_at TIMESTAMPTZ DEFAULT NOW())`
- services/minutes.py：`generate_minutes(con, conv_id, limit=50)`（取最近 limit 条 message 倒序后反转为时间线 → transcript `【ts】sender：content` → llm_chat(MINUTES_SYSTEM, transcript, json_mode=True) → json.loads（失败抛 ValueError → 路由层 500/502）→ INSERT → audit minutes_generated → 返回 dict）；`list_minutes(con, conv_id=None)`；`get_minutes(con, id)`；`minutes_to_task(con, minutes_id, index)`（校验 index → insert_task(content, creator=f"minutes#{id}", assignee=hint or None, deadline=hint or None, status="pending_confirmation", confidence="high", source_msg=title)）。
- json 字段读取时 `json.loads(row["decisions"]) if row["decisions"] else []`。

**Step 4:** G7 全绿后 Commit — `feat: minutes 表 + 纪要生成服务`

### Task 2: routes_minutes.py + 注册

**Files:**
- Create: `imai/api/routes_minutes.py`
- Modify: `imai/api/__init__.py`（include_router）

**Step 1:** 四个端点按 Spec §3.4；空会话/越界 → HTTPException(400)；不存在 → 404。
**Step 2:** G7 全绿；`python -m pytest tests/ -q --ignore=tests/guard_pg --ignore=tests/guard_async --ignore=tests/eval` 无回归。
**Step 3: Commit** — `feat: 纪要 API（生成/列表/详情/转任务）`

### Task 3: 前端纪要面板

**Files:**
- Modify: `desktop/src/index.html`（board-tabs 加「纪要」tab + panel-minutes：select#minutesConv + input#minutesLimit + 生成按钮 + #minutesList）
- Modify: `desktop/src/app.js`（loadMinutes：拉 /gw/conversations 填下拉 + 拉纪要列表渲染卡片；generateMinutes；minutesToTask；dispatch case）

**Step 1:** tab `<button class="tab" data-action="tab" data-panel="minutes" data-loader="loadMinutes">纪要</button>`；面板结构仿 memory 面板。
**Step 2:** 卡片渲染：标题 + 摘要 + 结论列表 + 行动项（每条带「转任务」按钮 data-action="minutesToTask" data-mid data-index）+ msg_count/时间。
**Step 3:** `node --check desktop/src/app.js && cp desktop/src/app.js web/app.js`
**Step 4: Commit** — `feat: 纪要面板 UI（选会话生成/历史列表/行动项转任务）`

### Task 4: 回归 + 真机 + 收尾

**Step 1:** `python -m pytest tests/ -q` 全绿
**Step 2:** 重启后端 → 真机冒烟：造几条会话消息 → 生成纪要（真实 LLM）→ 转任务 → 看板确认
**Step 3:** `python scripts/acceptance.py` → 12/12
**Step 4:** 交接文档版本状态、Spec 验收勾选；Commit — `docs: 迭代2 B2 收官`
