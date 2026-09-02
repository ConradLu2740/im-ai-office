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
| 后端生命周期 | 主进程 spawn `node dist/index.js`（esbuild 打包后端为单文件，生产不再依赖 tsx/node_modules） |
| 系统托盘 | 最小化到托盘 + 未读消息角标数（数据源：SSE/轮询） |
| 桌面通知 | 新任务 / 到期提醒 / 每日汇总 → `Notification` API（提醒从会话内升级为系统级） |
| 开机自启 | `app.setLoginItemSettings`（Electron 原生，替代 IMAI Autostart 计划任务的后端部分） |
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
user_last_read(user_id, conv_id, last_msg_id)    -- 未读计数
```
登录：username + password → session token（httpOnly cookie 或 Bearer），替代 /openim/login。

### 4.2 消息流
```
发送：UI → POST /api/messages/send（会话内直接落库 + fanout）
接收：WS 连接（登录后建立）→ 群消息实时推送；断线重连拉增量（last_msg_id）
离线：消息全在 message 表，重连/进会话拉历史（现状逻辑平移）
未读：per-user last_read 水位
```
删除：/openim/* 三端点、callback 全套、OpenIM token 体系、`/api/sdk_message`（测试入口改打新发送端点）。

### 4.3 数据一次性导入
Mongo → app_user/user_group/group_member（用户 3 + 群 1 + 成员关系）；聊天历史以本地 message 表为准（已是渲染权威），OpenIM 侧数据不迁。

### 4.4 已知代价（用户已确认接受）
- 无图片/文件消息（现状本就不支持，未来按需加）
- 无多端消息同步（web 多标签以 last_msg_id 去重兜底）
- IM 细节功能（已读回执/撤回/表情回应）按需自建
- 移动端：响应式 web（不做原生）

## 5. 分阶段计划（每阶段 acceptance 全绿为门槛）

| 阶段 | 内容 | 量 | 验收 |
|---|---|---|---|
| **P0 基建** | npm workspaces monorepo（backend-ts/frontend-ts/electron/scripts 四包）；acceptance.py + quality_report.py 移植 TS（Python 清零）；Electron 骨架（托盘/通知/自启/后端管理，替代 Tauri 与 IMAI Autostart） | 1-2 天 | `npm install` 一次通过；Vitest E2E（原 acceptance 12 项）全绿；Electron 启动→后端拉起→UI 可用 |
| **P1 数据层** | Drizzle introspect + 全量改写；drizzle-kit 迁移接管 schema | 半天 | Vitest 全绿；生产 schema 无 diff |
| **P2 契约** | 后端路由链式化；前端接 Hono RPC；app.ts 开始摘 @ts-nocheck | 半天 | 前端 tsc 无 API 层错误；拼错字段编译期报错（哨兵用例） |
| **P3 聊天层** | WS + 新表 + Mongo 导入 + OpenIM 全下线（Docker 清空）+ 登录/会话/发送/历史/未读全链切换 | 2-3 天 | acceptance（聊天部分重写后）全绿；浏览器走查；**OpenIM 6 容器删除** |

依赖关系：P0 → P1 → P2 → P3（P2 可与 P1 调换；P3 必须最后）。

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 聊天层自研可靠性（丢消息/重复） | 消息落库先行 + fanout 允许丢帧 + 重连拉历史兜底（现状已验证的模式平移）；clientMsgID 去重保留 |
| Electron 打包体积/复杂度 | 后端打包为单 dist/index.js（不含 node_modules）；electron-builder 标准流程 |
| 重构挤占识别质量主线 | **每阶段之间留 ≥3 天观察窗口**；识别质量（57.7%→80%）的打磨不因重构中断 |
| AI SDK 版本变动 | package.json 精确锁版本 + 锚点封装 |
| 回滚 | 每阶段独立 commit/tag；OpenIM 下线前打 `openim-era-final` tag，数据有 Mongo 备份 |

## 7. 明确不做

- React/Vue/Vite dev server、GraphQL、微服务、Kubernetes、知识图谱、移动端原生
- Electron 自动更新（P1 不做，后续按需）
