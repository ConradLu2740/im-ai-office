# IMAI · 事件化 + AI 异步化 Spec（Step 2）

> 时间：2026-08-27 ｜ 关联：《架构分析报告.md》Step 2 ｜ 前置：step1-done（e1a31b6，imai/ 四层包已就位）
> 核心目标：**用户的 HTTP 请求永不等待 LLM**；消息事件可靠入队、AI 判定异步消费、同源重放不产生重复任务。

---

## 1. 运行时现状澄清（2026-08-27 实测，修正《模块划分.md》的过时结论）

**services/ 微服务雏形不是摆设，是正在运行的第二套 AI 处理器**：

```text
                    ┌─ SDK网关→ app.py/imai(主链路, SQLite) ← 桌面端在用
真实群聊消息 ──┤
                    └─ oim-webhook容器 → Redis msg流 → imai-ai-agent容器(独立LLM/记忆实现)
```

实测证据：
- 容器全活：imai-{redis,postgres,oim-webhook,ai-agent,board-api,reminder} Up 5 days
- `msg` 流有真实数据（如 msgId=mem_003），ai-agent 日志显示正在跑 LLM 识别 + 修正信号沉淀
- ai-agent 消费方式：`XREADGROUP(group='ai-agent', consumer='c1')` + 处理后 `XACK`

**含义**：同一句话目前可能被两套 AI 分别处理、落进两个数据库。本 Step 的异步 worker 将按下方「接管」方案收敛为单消费者。

## 2. 目标形态与行为矩阵

```
入口(三处) ──XADD──▶ Redis msg流 ──consumer group: imai-core-worker──▶ AI worker线程
                                                                  ├─ dedup(event_dedup表)
                                                                  ├─ pipeline.process_message
                                                                  ├─ 动作执行(确认卡/私聊/SSE播报)
                                                                  └─ audit(latency埋点)
前端轮询保留 + 新增 SSE /api/events/stream 实时收事件（断线自动重连）
```

**Feature Flag**：`IMAI_AI_MODE = sync（默认）| async`

| 入口 | sync 模式（默认） | async 模式 |
|---|---|---|
| POST /callback | 现行为不变 | 校验/解析后 XADD → 追加返回 `"accepted": true, "queued_event": "<id>"` |
| POST /api/sdk_message | 现行为不变 | 同上 |
| POST /api/simulate_message | 现行为不变 | 同上 |
| POST /api/chat | 现行为不变 | 保持同步（调试用途，注释说明） |
| **重复投递防护** | 无（g1_5 锁定的现状） | **启用：30 分钟去重窗口**（见 §4） |

- sync 为默认：Guard 26 用例零改动全绿；生产影响为零。
- async 切换仅靠 `.env` 一行；启动时若 async 但 Redis 不可达 → **降级回 sync 并打 ERROR 日志**（宁可用旧路径也不丢消息）。

## 3. 事件协议（沿用 msg 流现有协议，零迁移成本）

生产者字段（oim-webhook 已在生产此格式，本地入口对齐）：

| 字段 | 含义 | 来源 |
|---|---|---|
| event | 固定 `message.created` | 三入口统一 |
| msgId | 幂等键 | callback=msgID；simulate/sdk_message 显式传或确定性生成 `sha256(conv\|sender\|text)[:16]` |
| grpId | 会话 id（callback 的 groupID 或入口 conv_id） | |
| senderId / senderName | 发送者 | sendID/sender 映射 |
| content / type / at | 文本/类型/时间戳 | |

消费组：新 worker 使用 **group=`imai-core-worker`, consumer=`c<pid>`** ——Streams 多 group 天然广播隔离，与旧 ai-agent 的 `ai-agent` 组互不干扰；XACK 后即完成。启动时 XAUTOCLAIM 回收空闲 >60s 的 pending 消息（防崩丢）。

## 4. 幂等设计（治理缺陷 #3，g1_5 的对症解）

- 新表 `event_dedup(msg_id TEXT PRIMARY KEY, consumed_at TIMESTAMPTZ)`（SQLite 兼容 TEXT 时间）。
- worker 消费前 `INSERT OR IGNORE` 判重；重复则 ACK 跳过。
- **确定性 msgId 的重放误伤问题**：同 sender 同文本跨日再发会被误判。对策：**去重窗口默认 30 分钟**（`IMAI_DEDUP_WINDOW_SEC=1800` 可配）：仅在 `consumed_at > now-window` 内视为重复，过期允许再次成任务。该窗口是产品语义决策点，默认值待实战回调。
- 只在 async 模式生效；sync 模式维持 g1_5 锁定的现状（缺陷实证继续成立直至翻转默认模式）。

## 5. Worker 设计（部署形态零变化）

- **不引入 arq/Celery**：create_app startup 内启动 **1 个 daemon 线程**跑 consumer loop（XREADGROUP BLOCK 5000 count 10）；单机自用吞吐瓶颈在 LLM 本身，1 worker 足够。理由：进程数零增加（Tauri/cli.py 编排不改）、打包不变、代码 ~120 行 vs 引入一整套任务框架。
- 处理函数复用现有服务：pipeline.process_message + 歧义私聊动作（从 routes_openim.handle_openim_callback 提炼 `execute_ai_actions(result)` 共享，收敛第 5 处潜在复制）。
- 可观测：worker 完成/失败均写 audit(action=`ai_processed`)，detail 带 `{latency_ms, action, taskId}` —— 满足「延迟可观测」，不另建 metrics 端点。
- 优雅退出：进程退出标志位置位 + 10s 上限等待。

## 6. SSE 实时推送（替代部分轮询，终端 WS 留 Step4 后）

- 端点 `GET /api/events/stream`（text/event-stream）：凡产生 `task_created / confirm_assignee / task_confirmed / reminder.due` 时经进程内 fan-out 推送。
- 前端 `desktop/src/index.html` 仅**追加** ~40 行 EventSource 接收代码（分发到既有 loadTasks/updateAIUnread），五个轮询定时器一个不删（兜底），先 SSE 后 WS 符合报告风险 #5 结论。

## 7. 测试策略（安全网双轨延续）

| 层 | 方式 |
|---|---|
| Guard sync（存量 26 用例） | 默认模式不动 → **必须原样全绿** |
| Guard async（新增 tests/guard_async/，约 8–10 用例） | 直连**真 Redis**（已在跑；测试专用 redis db=15，起止 FLUSHDB 隔离）：受理响应结构 / 终态一致（轮询等待 task 出现，超时判失败）/ G1.5 反转（30min 窗口内重放被拒）/ SSE 流收到对应事件 / worker 直接调用的纯逻辑分测 |
| Eval | 链路未变，末尾对照基线一次（≥19/20） |

依赖新增：`redis>=5`（pip 包，仅 Python 客户端）。

## 8. 明确不做（防扩散）

❌ arq/Celery/Kafka ❌ WebSocket（SSE 起步）❌ 多 worker 扩容 ❌ 删除五个轮询定时器 ❌ Postgres（Step3）❌ 改桌面打包清单 ❌ oim-webhook 协议变更

## 9. 验收标准（Definition of Done）

1. `.env` 不加任何开关时：guard 26 全绿 + eval ≥19/20（回归无损）
2. `IMAI_AI_MODE=async` + 真 Redis 下：guard_async 全绿；uvicorn 启动日志显示 worker 就绪；人工从 callback 投一条歧义消息 → 数秒内 ai_dm 出站确认 + SSE 收到事件 + latency 已进 audit
3. async 模式下 60s 内重放同 (conv,sender,text)：第二次不建任务且 events 显示 dedup_skip
4. Redis 停掉时以 async 启动：自动降级 sync 且日志 ERROR 说明

## 10. 需要你拍板的决策点

| # | 决策 | 建议 |
|---|---|---|
| D1 | **双消费者接管**：async 验证通过后执行 `docker stop imai-ai-agent imai-oim-webhook`（services 四件套停止使用，其余留 Postgres/Redis 基础设施） | ✅ 建议随本 Step 执行，消除双份 AI 处理；stop 可随时 start 回滚 |
| D2 | 去重窗口 30 分钟 | ✅ 可调参数先行，实战后校准 |
| D3 | 默认模式保持 sync，切 async 由 .env 控制 | ✅ 待一段稳定运行后再翻默认（列入 Step3 前 checklist） |

---

*依据：架构分析报告.md Step2 · 运行时实测 2026-08-27 · 待批准后进入实施*
