# IMAI · 统一技术栈架构演进 Spec（v1 · 2026-09-02 评审定稿）

> 背景：后端 TS 重写 + 前端 TS 化完成后，用户决策对剩余架构做"统一管理"收敛。
> 用户拍板（2026-09-02）：Tauri→Electron（承担更多）、DB→Drizzle、LLM→Vercel AI SDK（保守封装）、运维→Node、monorepo+Python 清零、Hono RPC、**自建聊天层替代 OpenIM**。
> 关键前提确认：**同事将真实迁入本系统日常办公沟通**（聊天密度=硬需求）；**移动端不做**；AI SDK 接受保守封装。

## 0. 目标架构（终态）

```
Electron（TS 主进程 + 原生 TS 渲染层）
   │ IPC / HTTP / WebSocket
TS 后端单体（Hono + Drizzle + Zod + Vercel AI SDK）
   ├── 聊天层（WS 群聊路由 + 离线历史 + 未读，替代 OpenIM）
   └── AI 管线（识别/确认/提醒/记忆/权限/纪要/统计）
PostgreSQL（唯一数据库：业务 + 聊天，Drizzle 管理 schema）
DeepSeek / 本地模型（AI SDK provider 切换）
```

**运维终态**：一个 monorepo（npm workspaces）、一个 runtime（Node）、一个数据库（PG）、零 Docker、零 Python、零 Rust 工具链。

## 1. Electron 承担更多（用户明确要求）

| 职责 | 设计 |
|---|---|
| 后端生命周期 | 主进程 spawn `node dist/index.js`；esbuild 打包时**将 pg/zod/hono 等依赖全量内联**（均为纯 JS，无原生模块）——产物仅需 Node 运行时，无需 node_modules。**分发决策（评审陷阱）**：目标机器若无 Node，需随包内嵌便携 node.exe（extraResources，+30MB）→ P0 验收含此实测；主进程退出钩子杀后端子进程树 + 启动时端口预检 + crash 退避重启 |
| 系统托盘 | 最小化到托盘 + 未读消息角标数（数据源：SSE/轮询） |
| 桌面通知 | 新任务 / 到期提醒 / 每日汇总 → `Notification` API（提醒从会话内升级为系统级） |
| 开机自启 | `app.setLoginItemSettings`（**需同时禁用既有 IMAI Autostart 计划任务，避免双轨自启冲突**——评审 6） |
| 自动更新 | electron-updater（后置，P1 不做） |
| 安全基线 | contextIsolation:true、nodeIntegration:false、preload 暴露白名单 IPC（平移 api_call 模式） |

## 2. Drizzle ORM（数据层）

- drizzle-kit introspect 现有生产 schema → 生成 TS schema 定义（不手写跑偏）
- repos.ts + 服务层内联 SQL 全部改写为 Drizzle 查询；复杂聚合（stats 分位）走 `sql` 模板逃生舱
- schema 演进从此有版本记录（根治"生产库缺列"类坑）
- 测试库 imai_test 同套 schema，Vitest beforeEach 清库重建

## 3. Vercel AI SDK（LLM 层，保守封装）

- 仅替换 `llm.ts` 的 `_impl`：`generateObject({ schema, maxRetries })` 承接意图结构化输出；`generateText` 承接纪要/挖掘
- **锚点纪律不变**：`getLlm()` 单一入口、测试 `setLlmImpl` 注入、provider 版本锁死（package.json 精确版本）
- M5 本地切换：OpenAI-compatible provider 指向本地端点，只改配置

## 4. 自建聊天层（替代 OpenIM，P3 核心）

### 4.1 新表（Drizzle）
```
app_user(id, username UNIQUE, display_name, password_hash(scrypt), role, created_at)
user_group(group_id, name)                       -- 从 OpenIM Mongo 导入
group_member(group_id, user_id, joined_at)       -- 从 OpenIM 导入
user_last_read(user_id, conv_id, last_msg_id,    -- 未读水位；更新用 GREATEST 防多标签竞态
               PRIMARY KEY(user_id, conv_id))

身份映射（评审 D1/D2 严重项）：**app_user.id 直接复用 OpenIM userID**（如 user001），
历史 message.sender_id / task.creator / ai_dm.sender_id / role.oim_user_id 全部天然对齐，
禁止另起新 id 体系；message 表补 UNIQUE(conv_id, client_msg_id)（PG 唯一约束才是并发最终防线）。
```
登录：username + password → session token（httpOnly cookie 或 Bearer），替代 /openim/login。

### 4.2 消息流与 AI 入口迁移（v2 修订——评审致命项 1/7）

**决策：不引入 WebSocket，复用既有 SSE 通道**（聊天场景=纯接收推送+HTTP 发送+断线拉历史，SSE 已验证可用；WS 的连接管理/鉴权/心跳是一整类新复杂度，评审一致建议砍掉）。

```
发送：UI → POST /api/messages/send
      → 落库（唯一约束幂等）→ 同步内联触发 AI 管线（processMessage + clientMsgID 闸门平移）
      → fanout("message") → SSE 推给全部在线成员
接收：既有 EventSource /api/events/stream（含 message / ai.card / task_created / reminder / digest 事件）
离线：消息全在 message 表，重连/进会话拉历史（现状逻辑平移）
未读：per-user last_read 水位（GREATEST 单语句更新，防多标签竞态）
```

**AI 入口迁移（评审致命项——原稿遗漏，P3 不做则确认/提醒链路静默断裂）**：
- 现状「OpenIM 回调是唯一落库+AI 入口」→ P3 后 send 端点内联承担（回调处理函数改为内部函数直接调用）
- AI DM 确认卡 / 每日汇总 / 到期提醒触达：ai_dm 表（现状）+ SSE 事件推送，删除 openimClient 私聊代发
- 提醒调度器 reminder/digest 不依赖 OpenIM，平移即可

**去重键统一（评审 D3）**：fanout payload 统一携带 DB id + client_msg_id；前端以 DB id 幂等（历史重建前清 _seenMsgIDs、DB 行唯一渲染权威的模式保留）。

**幂等强化（评审 D2）**：message 表加 `UNIQUE(conv_id, client_msg_id)`，messageAdd 改 `INSERT ... ON CONFLICT DO NOTHING RETURNING`（现 check-then-insert 在并发下可产生重复行——历史踩坑根因模式）。

删除：/openim/* 全部端点、callback 全套、OpenIM token 体系；`/api/sdk_message` 测试入口改打新发送端点。

### 4.3 数据一次性导入与校验（评审补充完整清单）
- Mongo → app_user/user_group/group_member（用户 3 + 群 1 + 成员关系），id 复用 OpenIM userID
- 三处一致性校验：group_member ↔ person.group_id ↔ grp_meta/role
- user_last_read 初始化为导入时刻各会话 max(message.id)（否则全员历史消息变未读）
- 凭证分发：app_user 密码为新建，切换日前分发，避免切换日全员无法登录
- 导入后校验：用户数/群数/成员数核对 + 每用户消息数抽样比对
- 聊天历史以本地 message 表为准（已是渲染权威），OpenIM 侧数据不迁

### 4.4 已知代价（用户已确认接受）
- 无图片/文件消息（现状本就不支持，未来按需加）
- 无多端消息同步（web 多标签以 last_msg_id 去重兜底）
- IM 细节功能（已读回执/撤回/表情回应）按需自建
- 移动端：响应式 web（不做原生）

## 5. 分阶段计划（每阶段 acceptance 全绿为门槛）

| 阶段 | 内容 | 量 | 验收 |
|---|---|---|---|
| **P0 基建** | npm workspaces monorepo（backend-ts/frontend-ts/electron/scripts 四包）；acceptance.py + quality_report.py 移植 TS（Python 清零）；Electron 骨架（托盘/通知/自启/后端管理，替代 Tauri 与 IMAI Autostart） | 1-2 天 | `npm install` 一次通过；Vitest E2E（原 acceptance 12 项）全绿；Electron 启动→后端拉起→UI 可用 |
| **P1 数据层** | 先对齐 imai/imai_test 的 audit schema 漂移（一次性迁移）→ drizzle-kit pull 基线 + migrate 接管 → 全量改写（**用稳定版 0.44.x，避开 beta**；int8 用 mode:'number'） | **1-2 天**（评审：原估半天严重低估，含 drift 对账脚本） | Vitest 全绿；drizzle-kit 无待应用迁移 |
| **P2 契约** | 后端路由链式化；前端接 Hono RPC；app.ts 开始摘 @ts-nocheck | 半天 | 前端 tsc 无 API 层错误；拼错字段编译期报错（哨兵用例） |
| **P3 聊天层** | SSE 通道 + 新表（含 AI 入口迁移）+ Mongo 导入 + 登录/会话/发送/历史/未读全链切换。**前置：P1 必须先完成**（新表以 Drizzle 定义落地，避免返工） | 2-3 天 | acceptance 聊天部分重写后全绿；浏览器走查；**AI 入口迁移 E2E：建任务→确认→提醒→完成全链** |

依赖关系：P0 → P1 → P2 → P3（评审修正：**P1 是 P3 的硬前置**——聊天层新表必须以 Drizzle 定义，否则先写旧模式再返工；P2 可与 P1 调换）。

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 聊天层自研可靠性（丢消息/重复） | 消息落库先行 + fanout 允许丢帧 + 重连拉历史兜底（现状已验证的模式平移）；clientMsgID 去重保留 |
| Electron 打包体积/复杂度 | 后端打包为单 dist/index.js（不含 node_modules）；electron-builder 标准流程 |
| 重构挤占识别质量主线 | **每阶段之间留 ≥3 天观察窗口**；识别质量（57.7%→80%）的打磨不因重构中断 |
| AI SDK 版本变动 | package.json 精确锁版本 + 锚点封装 |
| 回滚 | 每阶段独立 commit/tag；切流前 pg_dump + Mongo dump **双快照同一时点**；**OpenIM 6 容器切流后保留 2-4 周观察期再删除**（评审 ③：回滚窗口内经自建通道发送的消息不在 Mongo 里，单向切流需书面声明） |

## 7. 明确不做

- React/Vue/Vite dev server、GraphQL、微服务、Kubernetes、知识图谱、移动端原生
- Electron 自动更新（P1 不做，后续按需）


## 8. 评审修订记录（v2 · 2026-09-02 · 三份对抗/可行性/可靠性审查报告采纳）

**采纳并已修订上文**：
1. P3 补「AI 入口迁移」章节（对抗审查致命项：原稿只写"落库+fanout"，删 OpenIM 后确认/提醒链路会静默断裂）
2. 身份映射：app_user.id 复用 OpenIM userID（两份审查均判严重）
3. message 表补 UNIQUE(conv_id, client_msg_id) 唯一约束（check-then-insert 并发重复根因模式）
4. **P3 不用 WebSocket，复用 SSE**（评审 A#7：聊天场景 SSE 已验证够用，WS 是一整类新复杂度）
5. P1 前置对齐 audit schema 漂移 + 工时改 1-2 天；P1 为 P3 硬前置
6. Electron：依赖内联进 dist（纯 JS 依赖）+ 内嵌 node 二进制决策移入 P0 验收；禁用双轨自启；crash 退避重启；动态端口预检
7. Drizzle 用稳定版 0.44.x + pull/generate/migrate 工作流（beta 有 JSONB push bug 记录）
8. AI SDK 锁 ai@5.x 精确版本 + DeepSeek JSON mode 兜底
9. 迁移清单补全（水位初始化/凭证分发/导入后校验/event_dedup 处置）
10. 回滚预案修正：双快照 + OpenIM 容器保留 2-4 周 + 切流窗口消息丢失书面声明
11. P0 parity 门禁分两层：Vitest 契约层（mock）+ acceptance-live 脚本打真实环境（P3 前后各对账一次）
12. Hono RPC 确认可行：**必须链式合并并使用返回值**（`app = base.route(...)` 语句式调用会丢类型）；前后端 hono 版本对齐

**被挑战后仍成立**：Python 清零 / monorepo / Drizzle 方向 / AI SDK 保守封装 / OpenIM 下线方向 / Mongo 导入规模 / 每阶段观察窗口 / 回滚 tag 策略。

**驳回的替代方案**：保留 OpenIM 最小集（3 容器）缓期 P3——评审 A 提出后判定：用户已确认真实迁入 + 运维收益明确，缓期只延迟收益不消除风险；记录在案，若 P3 实施中聊天层可靠性受阻可重启此选项。
