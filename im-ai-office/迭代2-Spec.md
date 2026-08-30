# 迭代 2 Spec · 任务可修改 + 记忆库管理（B1 + B3）

> 更新：2026-08-30 · 决策来源：迭代2-候选对比.md 用户勾选「B1 → B3 → B2」
> 范围：本轮实施 B1、B3；B4 并入记忆主题的 Backlog；B2（会议纪要）单独立 Spec。

## 1. B1 · 任务可修改（优先级 P0）

### 1.1 问题
任务确认后即锁死：改负责人、改截止时间、取消任务都做不到。截止时间一变，旧提醒档位也不会重算。

### 1.2 范围
| 能力 | 行为 |
|---|---|
| 改负责人 | 已确认任务可修改 assignee（任意文本，走现有别名体系显示） |
| 改截止时间 | 已确认任务可修改 deadline；格式 `YYYY-MM-DD HH:MM`；同时更新 deadline_at |
| **提醒重算** | deadline 变更时删除该任务的 reminder_sent 记录，三档提醒（24h/当天/逾期）按新时间重新起算 |
| 取消任务 | 已确认任务可取消 → 新终态 `cancelled`；提醒调度不再命中；看板不再显示 |

### 1.3 不做（YAGNI）
- 不做改任务内容（content 来自原始消息，溯源语义会断）
- 不做修改 pending_confirmation / pending_assignee 状态的任务（走确认/驳回流）
- 不做修改历史记录回滚 UI（audit 已留痕，够用）

### 1.4 接口
```
PATCH /api/tasks/{task_id}
  body: { "assignee"?: str, "deadline"?: "YYYY-MM-DD HH:MM", "action"?: "cancel" }
  200 {ok: true, task: {...更新后}}
  404 任务不存在    400 deadline 格式非法 / 无任何变更字段
```
- 每处修改写 audit：`action='task_update'`，detail `{taskId, field, old, new}`
- deadline 修改时：`DELETE FROM reminder_sent WHERE task_id=?` + audit 记录 `reminder_reset`

### 1.5 前端
- confirmed 卡片新增「编辑」「取消」按钮（事件委托 data-action，兼容 CSP）
- 编辑 = 卡片内联表单：负责人文本框 + datetime-local + 保存/放弃
- 取消 = 两步确认（点一下按钮变红色「确认取消?」，再点才生效；不用阻塞式弹窗）

### 1.6 验收标准
- [x] pytest 新增 G6 用例全绿：改负责人/改期/取消/404/非法 deadline/提醒重置（7 用例）
- [x] 存量用例无回归（85 passed；guard_async 重放去重 1 例偶发时序失败，单独重跑通过，与本次改动无关）
- [x] 真机冒烟：改负责人/改期/取消生效且看板消失；acceptance.py 12/12 PASS
- [x] desktop/src/app.js 与 web/app.js 同步

## 2. B3 · 记忆页手动增删（优先级 P1）

### 2.1 问题
团队术语库只进不出：识别错了没法改、没用的没法删。

### 2.2 范围
| 能力 | 行为 |
|---|---|
| 新增术语 | 已有 `POST /api/term/add`，前端补入口 |
| 修改释义 | 新端点 `PATCH /api/term/{term}` body `{meaning}` |
| 删除术语 | 新端点 `DELETE /api/term/{term}`；audit 留痕 `term_delete` |
| 前端 | 记忆页每条术语加 ✎/🗑 按钮（🗑 两步确认）；顶部「新增术语」表单 |

### 2.3 不做
- 不做批量导入/导出（B4 历史挖掘时一起看）
- 不做删除保护/权限（单人内网工具，audit 留痕即可）

### 2.4 验收标准
- [x] pytest：改/删/错误分支用例全绿（含 audit 留痕）
- [x] 生产库实机验证：add/patch/delete 200、重复删 404（旧 PG 库 term 表缺列/缺唯一约束已由 init_db 幂等迁移修复）
- [x] desktop/src/app.js 与 web/app.js 同步

## 3. B2 · 会议纪要（优先级 P0，本轮实施）

### 3.1 问题
群聊即任务只覆盖单句指派；一段讨论（会前对齐、会后分工）里的结论和分工没人沉淀。

### 3.2 范围
| 能力 | 行为 |
|---|---|
| 生成纪要 | 选会话 + 最近 N 条消息（默认 50）→ LLM 生成 `{title, summary, decisions[], action_items[{content, assignee_hint, deadline_hint}]}`；落 `minutes` 表 + audit `minutes_generated` |
| 纪要列表/详情 | 新「纪要」面板：历史纪要卡片（标题/摘要/结论），按会话过滤 |
| 行动项转任务 | 每条 action_item 一键转任务：`pending_confirmation` 进看板走正常确认流，creator=`minutes#{id}`，deadline_hint 原样透传（解析交给现有 backfill） |
| 会话选择 | 复用网关 `/gw/conversations`（conversationID + showName），与左侧会话列表同源 |

### 3.3 设计决策
- **同步生成**：用户主动触发、等待结果，不入 worker 队列（消息管道的 async 模式只服务自动识别链路）；LLM 调用复用 `llm_provider.llm_chat`
- **decisions/action_items 存 JSON 文本**（PG 用 TEXT 非 JSONB）：双方言一致，读取时 json.loads
- **转任务走 pending_confirmation**：复用确认/驳回/提醒全链路，不另造终态；重复点击会建重复任务，v1 接受（audit 可查）
- **消息窗口 = 最近 N 条**：不做时间段选择（YAGNI，历史挖掘是 B4）

### 3.4 接口
```http
POST /api/minutes/generate  {conv_id, limit?=50}  → {ok, minutes}   400 会话无消息
GET  /api/minutes?conv_id=                         → {ok, minutes:[...]}
GET  /api/minutes/{id}                             → {ok, minutes}   404
POST /api/minutes/{id}/task  {index}               → {ok, taskId}    404/400 index 越界
```

### 3.5 验收标准
- [ ] pytest G7：生成（fake_llm）/列表/详情/转任务/错误分支全绿，存量无回归
- [ ] 真机：产品群生成一份纪要（真实 LLM），行动项转任务后在看板确认通过
- [ ] desktop/src/app.js 与 web/app.js 同步；acceptance 12/12

## 4. Backlog（本轮不做）
- **B4 历史消息挖掘**：分批拉历史 + 复用识别 pipeline + 人工确认入库（并入记忆主题）
- **D3 难例调优**：做 B2 时顺带调 prompt（同一条 pipeline）
