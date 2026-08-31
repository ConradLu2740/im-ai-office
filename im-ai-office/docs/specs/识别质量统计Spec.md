# 识别质量统计 Spec

> 更新：2026-08-31 · 动机：产品一页纸验收标准「80% 以上任务一次确认通过」目前无法量化——M0–M4 全部完成，但只有 eval 离线数据和人工冒烟，没有线上真实流量的质量数字。「任务识别误判率 = 信任命门」，命门需要基线数据。

## 1. 问题

1. 识别到底准不准？——没有线上一次确认通过率、驳回原因分布。
2. AI 链路延迟多少？——只有单次冒烟观察，没有 P50/P95。
3. 置信度（high/medium/low）与实际通过率是否对得上？——置信度标了一直没人校验过。

## 2. 数据现状盘点（2026-08-31 实查 audit / task / message）

| 信号 | 来源 | 现状 |
|---|---|---|
| 每次 AI 处理（含未建任务的消息） | audit `ai_processed`（msgId/action/taskId/content[:60]/latency_ms/source） | ⚠️ **仅 async worker 路径有**；sync 路径（`/api/sdk_message` 同步分支、`/api/chat` 直调 `process_message`）缺 → 统计前必须补 |
| 建任务 | audit `ai task_created`（taskId/content/assignee/deadline）+ `task.confidence` | ✅ |
| 歧义分流 | audit `ai identify_ambiguous`（taskId/candidates） | ✅ |
| 确认/驳回 | audit `user confirm`（taskId）/ `user reject`（taskId/reason） | ✅ |
| 修改/取消 | audit `user task_update`（field/old/new）、task.status=cancelled | ✅ |
| 消息总量 | message 表 | ✅ |
| 去重拦截 | audit `ai_dedup_skip`（worker/entry） | ✅ |

> 关键缺口：**当前线上主力是 sync 路径**（async 默认保持 sync，用户决策 2026-08-28），意味着现在跑 `ai_processed` 统计会漏掉绝大多数真实处理记录。

## 3. 指标定义（v1 口径）

| 指标 | 定义 |
|---|---|
| 触达消息数 | 窗口内 audit `ai_processed` 条数（= AI 实际处理的消息量） |
| 建任务数 | audit `ai task_created` 条数（按天趋势） |
| **一次确认通过率** | `confirm` 数 / (`confirm` + `reject`)，产品验收 80% 看这个 |
| 驳回原因分布 | `reject.reason` 分组计数 |
| 挂起任务 | `pending_confirmation` / `pending_assignee` 超过 48h 无 confirm/reject/cancel 的列表（疑似误判的代理信号：AI 建了卡、人理都不理） |
| 歧义率 | `identify_ambiguous` / `task_created` |
| 置信度校准 | task.confidence（high/medium/low）分组 × 各组实际 confirm/reject 数 |
| 识别延迟 | `ai_processed.latency_ms` 的 P50 / P95 |
| 去重拦截量 | `ai_dedup_skip` 条数（观察重放压力） |

## 4. 范围

| # | 改动 | 说明 |
|---|---|---|
| P0-a | **sync 路径补 `ai_processed`**：`routes_tasks.py` 的 sdk_message 同步分支与 `/api/chat` 调 `process_message` 后按 worker 同样格式补 audit（含 latency_ms 计时）；附守卫用例 | 数据补齐是其余一切的前提 |
| P0-b | 统计服务 `imai/services/stats.py::quality_report(con, days=7)`：纯读 SQL，双方言（PG `ts >= NOW()-interval` / SQLite `datetime('now','-N days')`，`audit_recent` 已有分支先例） | 不写任何数据 |
| P0-c | 端点 `GET /api/stats/quality?days=7` → JSON | 供后续前端/自动化使用 |
| P1-d | 周报脚本 `python scripts/quality_report.py [--days 30]`：复用 quality_report，输出文本到 stdout | 一条命令出基线报告 |

## 5. 不做（YAGNI）

- 不做自动告警/阈值通知（先看两周真实分布，再定阈值——没基线的阈值是拍脑袋）
- 不做误判人工标注队列（D3 难例已有单独决策：①用户决定先不动，②时刻点解析是 task #4 缺口）
- 不做按人/按群权限区分的报表（内网单人工具）
- **不动识别 prompt**（调优是拿到基线之后的下一个 Spec，避免无对照盲调）
- 不做前端「质量」面板（数字先跑起来，UI 等有使用节奏再加）

## 6. 接口

```http
GET /api/stats/quality?days=7
→ 200 {
  ok: true,
  window_days: 7,
  totals: { processed, task_created, ambiguous, confirm, reject, cancelled, dedup_skipped },
  one_pass_rate: 0.86,
  reject_reasons: [{reason, n}],
  confidence: [{confidence, created, confirm, reject}],
  pending_stale: [{taskId, content, status, age_hours}],
  latency: { p50_ms, p95_ms, n }
}
```

## 7. 实施注意（预估踩坑点）

- audit `ts` 时间过滤双方言分支（见 §4 P0-b）
- latency 计时语义对齐 worker.py：从进入 process_message 前起算、audit 在 mark_consumed 之前落（worker 是成功后落）；失败不记
- reject reason 是用户原话，周报原文展示即人名也照实出（内网工具，不脱敏；如需外发再议）
- `/api/chat` 是演示端点，是否计入统计可加 `source` 字段区分（worker 已有 source），守卫用例覆盖

## 7.5 实施期新发现（2026-08-31 真机）

1. **sync 入口共 5 个**：除原计划的 sdk_message/chat 外，simulate_message、openim_send（发送双保险）、openim_callback（回调 sync 分支）同样直调 `process_message`——全部接入 `pipeline.audit_ai_processed`（actor=api，source 区分），比原范围更完整
2. **生产 PG audit 是旧 schema**：时间列 `created_at`（代码 schema `ts`）、detail JSONB（读出即 dict、不能直接 LIKE）——stats.py 运行时探测列名 + `_loads` 双类型解析 + JSONB `::text` LIKE + PG `%%` 转义，guard_pg 新增 test_pg_stats 锁定
3. **guard_async AI_MODE 跨层泄漏**：session 级 client 使 async 模式保留到 session 末尾，guard_pg 用例需自行固定 sync（已写入交接文档已知问题 #10）

## 8. 验收标准

- [x] sync 全部 5 个入口产生 `ai_processed` 记录，格式与 worker 路径一致（G9.1-G9.4 守卫）
- [x] G 系列新增统计用例全绿（G9.5-G9.9 + guard_pg/test_pg_stats）：通过率/驳回分组/挂起任务/置信度校准/延迟分位/detail 双类型；全量 92 passed（guard_async 偶发时序失败与本次无关，单独重跑通过）
- [x] 真机（生产 PG + 真实 LLM）：造 4 任务 → 3 confirm + 1 reject，增量精确对上（confirm+3/reject+1/processed+4），rate 舍入口径一致，驳回原因进周报；测试数据已清理
- [x] `python scripts/quality_report.py --days 30` 一键输出文本周报（boot 显式报库，幂等 init_db）
