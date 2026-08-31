# 每日汇总兜底 Spec（M2 收尾）

> 日期：2026-09-01 · 类型：补全产品承诺闭环 · 关联：一页纸 M2「每日汇总兜底均已落地」的欠账

## 背景

产品规划（思路 §14 / 一页纸 M2）：**发送者当天未确认 → 下班前自动把待确认清单推给群主/管理员**。
实际状态：`/api/summary/daily` + `build_daily_summary` 已有（生成不推送），但无任何调度触发、
无推送动作——兜底闭环缺最后一环，任务仍可能静默漏掉。

## 实现

| 组件 | 变更 |
|---|---|
| `imai/services/digest.py`（新） | `scan_and_push(con, now)`：本地时间 ≥ `DIGEST_TIME`（默认 18:00）且当日未推 → 生成汇总 → 推送 → 落 `digest_sent` 幂等行 |
| `imai/scheduler.py` | `_loop` 每轮（60s）在到期提醒扫描后调用 `digest.scan_and_push`；推送时打日志 |
| `imai/config.py` | `IMAI_DIGEST_TIME`（默认 "18:00"）、`IMAI_DIGEST_ADMIN`（默认 "user001"） |
| `imai/db.py` | 新表 `digest_sent(digest_date TEXT PRIMARY KEY, count, pushed_at)`，SQLite/PG 双 schema，init_db 幂等建表 |
| `conftest.py` | `ALL_TABLES` 补 `digest_sent`（用例间清库） |

设计要点：
- **收件人**：`role` 表 `role='admin'`（RBAC 管理员，对接 M3）；为空回落 `DIGEST_FALLBACK_ADMIN`
- **通道**：ai_dm（AI 助手会话，UI 可见）+ SSE fanout（event=digest）+ audit（action=daily_digest_pushed），与到期提醒同型；不打群（防骚扰原则）
- **幂等**：`digest_sent` 按日期主键，重启/重复扫描不重发；跨天自然解锁
- **零未确认任务也推送**：「今日暂无待确认任务 🎉」——让管理员确认"今天没有漏"，而非沉默

`/api/summary/daily` 保持语义不变（预览/手动生成，不落 digest_sent、不标记已推）。

## 验证

- 新增 `tests/guard_remind/test_digest.py` 4 用例：未到点零副作用 / 到点四通道齐动 + 当日幂等 / 跨天再推 / role 表 admin 收件人 + 空清单文案。全过。
- 真实 PG：startup 自动建表 ✓；before-gate 调用零副作用 ✓；INSERT/SELECT/DELETE 翻译探针 ✓。
- 端到端：后端重启后调度线程运行中，2026-09-01 18:00 将自动首推（当日 10 条待确认）。
- 全量回归：108 passed + 1 例已知 SSE 时序抖动（交接文档 #10，单跑全过）。

## 后续可选

- digest 推送附带「一键确认」回复指令（回数字确认，复用 AI DM 消歧交互）
- 群主/管理员多级：grp_meta 挂群主字段后按群分流
