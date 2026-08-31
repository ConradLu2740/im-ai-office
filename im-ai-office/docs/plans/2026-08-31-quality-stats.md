# 识别质量统计 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补齐 sync 路径 `ai_processed` 审计缺口 → 落地线上识别质量统计（一次确认通过率/驳回原因/挂起任务/置信度校准/延迟分位）→ `GET /api/stats/quality` + `scripts/quality_report.py` 周报。

**Architecture:** 统计为**纯读服务** `imai/services/stats.py::quality_report(con, days)`，数据源全走现有 audit/task 表，不新增表、不写数据；sync 路径（`routes_tasks.py` 的 sdk_message 同步分支与 `/api/chat`）按 worker.py 同格式补 `ai_processed` audit（含 latency_ms 计时）。

**Tech Stack:** FastAPI、双方言 SQL（PG `NOW()-interval` / SQLite `datetime('now','-N days')`，参照 `repos.audit_recent` 分支先例）、pytest。

**Spec:** `docs/specs/识别质量统计Spec.md`

---

### Task 1: sync 路径补 ai_processed（P0-a，数据前提）

**Files:**
- Test: `tests/guard/test_g9_quality.py`（新建）
- Modify: `imai/api/routes_tasks.py`

**Step 1: 失败测试**

```python
def test_g9_1_sdk_message_sync_audits(client, fake_llm, db):
    # 走 /api/sdk_message 同步分支发一条自然任务消息（复用 helpers.make_intent 文案风格）
    # 断言 audit 出现 action='ai_processed'，detail 含 msgId/action/taskId/latency_ms/source
    # actor 用 'api'，source 用 'sdk_message'（与 worker 路径字段对齐，见 §7 实施注意）
def test_g9_2_chat_audits_with_source(client, fake_llm, db):
    # POST /api/chat → audit ai_processed 存在且 detail.source == 'chat'
```

**Step 2:** `python -m pytest tests/guard/test_g9_quality.py -q` → FAIL（无 ai_processed 记录）

**Step 3: 实现** — 两个调用点包计时并落 audit（成功才记，语义对齐 worker）：

```python
t0 = time.perf_counter()
ai_result = process_message(...)
audit_log(get_conn(), "api", "ai_processed",
          {"msgId": msg_id, "action": ai_result.get("action"),
           "taskId": ai_result.get("task", {}).get("taskId"),
           "content": (text or "")[:60],
           "latency_ms": int((time.perf_counter() - t0) * 1000),
           "source": "sdk_message"})   # chat 端点为 "chat"
```

**Step 4:** G9 两条全绿；`python -m pytest tests/ -q` 无回归

**Step 5: Commit** — `feat: sync 路径补 ai_processed 审计（quality 统计数据前提，G9 守卫）`

### Task 2: quality_report 统计服务（TDD）

**Files:**
- Test: `tests/guard/test_g9_quality.py`（追加）
- Create: `imai/services/stats.py`

**Step 1: 失败测试**（直接用 db fixture 造数：insert_task + audit_log 混合写，注意回填 ts）

```python
# 造数：4 个 confirmed+audit(confirm)、1 个 rejected+audit(reject, reason="不该建")、
# 1 个 identify_ambiguous、2 条带 latency_ms 的 ai_processed(100ms/300ms)、
# 1 个 updated_at 回填 3 天前的 pending_confirmation（挂起）
r = quality_report(con, days=7)
assert r["totals"]["confirm"] == 4 and r["totals"]["reject"] == 1
assert r["one_pass_rate"] == 0.75
assert r["reject_reasons"] == [{"reason": "不该建", "n": 1}]
assert r["latency"]["p50_ms"] == 100 and r["latency"]["p95_ms"] >= 300
assert r["pending_stale"][0]["age_hours"] > 48
# 空窗口 → 全 0 且除零安全（one_pass_rate=None）
```

**Step 2:** FAIL（模块不存在）

**Step 3: 实现** — `stats.py`：

- `_window_sql(days)`：双方言分支返回 `(sql片段, params)`（PG `%s`/interval，SQLite `?`/datetime）
- totals：单条 SQL 按/action COUNT；confidence 分组 `SELECT confidence, COUNT(*), SUM(status='confirmed')...`（SQLite/PG 布尔写法注意：用 `CASE WHEN` 保双方言）
- one_pass_rate：confirm/(confirm+reject)，分母 0 → None
- pending_stale：`status LIKE 'pending%' AND updated_at < now-48h`；age_hours 双方言计算（julianday 差 / EXTRACT(EPOCH)）
- latency 分位：数据量小，Python 端 sorted 取分位（不引窗口函数，双方言安全）
- 全程只读，不 commit

**Step 4:** G9 全绿 + 全量回归

**Step 5: Commit** — `feat: quality_report 统计服务（通过率/驳回/挂起/置信度/延迟，双方言）`

### Task 3: GET /api/stats/quality 端点

**Files:**
- Test: `tests/guard/test_g9_quality.py`（追加 1 例：HTTP 200、days 参数缺省 7、days=0 或负 → 400）
- Modify: `imai/api/routes_stats.py`（新建 router）+ `imai/api/__init__.py`（include_router）

**Step 1:** 测试 → FAIL（404）
**Step 2:** 实现：`days` 校验 1–365，透传 quality_report，包 `{ok: True, window_days, **report}`
**Step 3:** G9 全绿
**Step 4: Commit** — `feat: GET /api/stats/quality 端点`

### Task 4: scripts/quality_report.py 周报脚本

**Files:**
- Create: `scripts/quality_report.py`

**Step 1:** `import imai.boot`（环境显式引导，交接文档约定 #9）→ argparse `--days`（默认 7）→ 调 quality_report → 文本输出（对齐率/计数，中文列名，UTF-8；挂起任务列 taskId+content 前 40 字+age）

**Step 2:** 手跑 `python scripts/quality_report.py --days 30` 确认输出可读（连生产库）

**Step 3: Commit** — `feat: quality_report.py 一键周报脚本`

### Task 5: 回归 + 真机 + 收尾

**Step 1:** `powershell -ExecutionPolicy Bypass -File scripts\test-env.ps1` 快速层全绿；全量 pytest 无回归
**Step 2:** 真机校验：`scripts/acceptance.py` 12/12；按 Spec §8 造 3 confirm + 1 reject（含 reason）→ quality 数字精确对上（one_pass_rate=0.75）
**Step 3:** 交接文档「版本状态/迭代端点」追加 `/api/stats/quality` 与脚本用法；Spec 验收项勾选
**Step 4: Commit** — `docs: 识别质量统计收官更新`

---

**不做**（Spec §5）：自动告警、标注队列、prompt 调优、前端质量面板。
