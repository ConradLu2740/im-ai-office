# IMAI · 工作流缺口登记 + G1/G3/G4 修复 Spec（2026-09-02）

> 背景：架构合理性深度走查（2026-09-02）发现六个工作流缺口，均有代码实证。本 Spec 登记 G1-G6 并落地 G1/G3/G4 三个小项；G2（对账机制）单独立项，G5/G6 登记观察。

## 0. 缺口登记总表

| # | 缺口 | 实证 | 严重度 | 处置 |
|---|---|---|---|---|
| G1 | 任务无"完成"终态 → confirmed 任务逾期提醒永动（提醒文案让用户"更新状态"，但没有更新路径） | 全库 done/completed 零命中；reminder 扫描 `status='confirmed' 且过期 → overdue` | 高（伤信任，验收线"完成会同步看板"未落地） | **本 Spec 修复** |
| G2 | 回调单入口无对账——webhook 一次性推送，后端停机期间消息永久缺失 | handle_openim_callback 无补拉机制 | 高（可靠性） | **单独立项**（OpenIM REST 对账） |
| G3 | `/openim/send_message` 无鉴权且 user_id 可伪造；且全 API 面无凭证（前端 api() 不带凭证，实测） | routes_openim send 无 check；deps 哲学=env 未设置即放行 | 中（内网姿态） | **本 Spec 缓解**（审计留痕+登记姿态），统一鉴权另立 |
| G4 | deadline 解析失败静默（提醒调度 Spec §1.2 承诺的 `deadline_unparsed` 审计未实现） | 全库无 deadline_unparsed | 中（观测盲区→哑弹截止） | **本 Spec 修复** |
| G5 | sync/async 双脑：每个入口 if 分叉，行为对齐靠自觉（worker 已核对走同一 actions） | routes 各入口 if config.AI_MODE | 低（维护税） | 观察；观察期后决定删 async |
| G6 | 三层去重语义重叠（event_dedup 30min / clientMsgID 闸门 / message_add 幂等）——网关删除后 30min 窗口层价值存疑 | bus.is_duplicate 调用点 | 低 | 登记观察 |

## 1. G1 · 任务完成回流

### 1.1 状态机扩展
`pending_confirmation / pending_assignee → confirmed → done`（新增终态）；`cancelled` 不变。done 由两条路径进入：
- **手动**：看板确认卡新增「完成」按钮 → `POST /api/tasks/{id}/complete`
- **口头（P1 最小版）**：意图 schema 新增 `is_completion` 字段（"做完了/搞定了/完成了 XX"→ is_task=false, is_completion=true, content=事项）→ pipeline 命中后匹配任务：**assignee 与 sender 互相 LIKE 匹配** → 命中多条取最近；无匹配则不动（宁漏勿错）

### 1.2 行为
- `complete_task(con, task_id, actor)`：仅 confirmed/pending_* 可流转；audit `task_completed`（含 actor）；SSE fanout `task_completed`
- 提醒扫描白名单不含 done → 逾期提醒自然终止（无需改 reminder）
- 看板：done 任务保留展示（✅ 已完成徽标），不再逾期标红
- 口头完成属"尽力匹配"：匹配失败静默 skip，不建任务不打扰——登记为已知边界

## 2. G3 · 发送留痕（缓解）

- `/openim/send_message` 每次调用写 audit：`action=send_message, actor=user_id, detail={group/recv, client_msg_id, ip}`——冒充行为至少可追溯
- 登记姿态：全 API 面无凭证是既有内网决策（deps 兼容铁律）；统一身份层（登录 token 校验中间件）另立，不单点补

## 3. G4 · deadline_unparsed 审计

`backfill_pending` 解析失败（deadline 非空 → parse None）→ audit `deadline_unparsed`（taskId, deadline 原文）。幂等：同任务只记一次（deadline_at IS NULL 且未记过——用 reminder_sent 式去重或 audit 查重；实现取 audit 查重，量小）。

## 4. 测试

- G12.1 complete 端点：confirmed → done 翻转 + audit + 二次完成返回 ok=False
- G12.2 done 不再触发逾期档位（judge_tiers 对 status=done 返回空）
- G12.3 口头完成：is_completion 命中 → 该成员最近确认任务变 done + audit；无匹配 → skip 且不动任何任务
- G12.4 send 留痕：POST /openim/send_message（monkeypatch _openim_post）→ audit 出现 send_message
- G12.5 G4：deadline="宇宙末日"（不可解析）→ backfill 后 audit 出现 deadline_unparsed，且同任务二次回填不重复记
