# IMAI · 到期提醒调度 + 缺陷修复 Spec（迭代 1）

> 时间：2026-08-28 凌晨 ｜ 交付情况（2026-08-28 上午勘误）：四项缺陷修复随迭代 1 交付（tag remind-fixes-done）；**§1 三档提醒调度当时未实际落库**（模块/表/测试均缺失），2026-08-28 上午按本 Spec 补齐（guard_remind 24 用例 + scheduler 线程 + reminder_sent 表 + PG 迁移）｜ 关联：《架构分析报告.md》遗留项 + 《回归加固Spec.md》§8 附录 ｜ 前置：step4-done
> 目标：补齐产品闭环最后的硬缺口——「跟进提醒」；同时修复 4 个已锁定的现状缺陷。

---

## 1. 到期提醒三档调度

### 1.1 档位规则（产品思路 §12 既定，逐字落地）

| 档位 tier | 触发条件 | 动作 |
|---|---|---|
| `due_24h` | now ≥ deadline_at − 24h | 提醒负责人（发起人 ai_dm 静默抄送） |
| `due_day` | deadline_at 当天 00:00 起 | 提醒负责人 |
| `overdue` | now > deadline_at 且任务仍 confirmed | @负责人 + 发起人 + 逾期标记 |
| `unassigned` | pending_confirmation 且 assignee=待指派 超过 24h | 只提醒发起人「任务还没人认领」 |

去重：新表 `reminder_sent(id, task_id, tier, created_at)`，`UNIQUE(task_id, tier)`——每任务每档位只发一次。

### 1.2 deadline 解析器（`imai/services/deadline_parser.py`，纯规则零 LLM）

把 `deadline` 文本解析为 `deadline_at` 时间点，写入 task 双列（deadline_at 已在 Step3 PG schema 预留；SQLite 补列）。

支持模式（不区分「前/之内/以内」后缀，取时间点语义）：
`今天/明天/后天/大后天`、`周X/下周X/星期X`、`N天后`、`X号/X日`（当月或次月）、`月底`。
解析失败 → deadline_at 保持 NULL → 不参与提醒（audit 记 `deadline_unparsed`，可观测）。

### 1.3 调度器（`imai/scheduler.py`）

- daemon 线程，每 `IMAI_REMIND_INTERVAL_SEC`（默认 60s）扫描一轮；create_app startup 启动（与 worker 同型）
- 每轮：回填 pending 任务的 deadline_at（未解析过的）→ 判档位 → 查 reminder_sent 去重 → 发送
- 发送通道：**ai_dm 通知 + SSE fanout + audit**；OpenIM 群回写由 `IMAI_REMIND_TO_GROUP`（默认 0 关）控制——遵守防骚扰原则
- 发送内容文案逐条定义（含任务内容/负责人/截止），审计 action=`reminder_sent`

## 2. 四个缺陷修复（翻转哨兵用例）

| # | 缺陷 | 修复方案 | 哨兵翻转 |
|---|---|---|---|
| 1 | reject 正则过宽（“这不是任务”沉淀 人称:任务） | 正则去掉裸 `是` 触发词，改为 `(?:应该是\|改为\|负责人应该是\|正确负责人[:：]?)` | g1_4b 翻转：期望**不产生** 人称:任务 |
| 2 | callback 死分支（assigned vs confirmed） | 字面量对齐为 `confirmed`；补告知私聊（经 stub 收集断言） | g2_5 增强：断言告知私聊出现 |
| 3 | sync 无去重 | sync 模式入口同样计算确定性 msgId 并查/写 event_dedup（窗口同 30min）；重放返回 `"dedup": true` 且不重复建任务 | g1_5 翻转：重放后任务数=1 |
| 4 | simulate/sdk 不透传 group_id | 入口把 conv_id 传给 process_message → 记忆注入覆盖全部路径 | g4_2 增补 API 级断言 |

## 3. 测试策略

- `tests/guard_remind/`：parser 单测（各模式 + 失败）、档位判定、扫描集成（造 confirmed 任务 + 操纵 deadline_at → 调 scan → 断言 ai_dm/audit/reminder_sent）、unassigned 提醒
- 翻转用例：g1_4b / g1_5 / g2_5 增强随修复同步更新
- 全量回归：既有 47 用例除翻转项外原样全绿

## 4. 明确不做

❌ OpenIM 群回写默认开启 ❌ 逾期任务自动改状态 ❌ 提醒升级/抄送链配置化 ❌ deadline 解析覆盖自然语言长句（LLM 兜底另行评估）

## 5. 验收标准

1. guard / guard_async / guard_pg / guard_remind 全绿（翻转项按新契约）
2. 集成手测：造一条“明天前”confirmed 任务 → 扫描一轮 → ai_dm 出现 due_day 提醒 + reminder_sent 落库 + 不重复
3. tag `remind-fixes-done`
