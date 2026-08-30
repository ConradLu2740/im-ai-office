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

## 3. Backlog（本轮不做）
- **B4 历史消息挖掘**：分批拉历史 + 复用识别 pipeline + 人工确认入库（并入记忆主题）
- **B2 会议纪要**：历史拉取 + LLM 摘要 pipeline + 纪要→任务二次确认流；B1 落地后单独立 Spec
- **D3 难例调优**：做 B2 时顺带调 prompt（同一条 pipeline）
