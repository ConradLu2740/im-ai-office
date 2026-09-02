# IMAI · 对话式 AI 办公助手

> 内部自用 · 单机本地部署 · TypeScript 全栈（Hono + Drizzle + Electron）· 零 Docker / 零 Python / 零 Rust 工具链

## 架构一句话

```
Electron 壳（托盘/系统通知/开机自启/后端子进程生命周期）
   │ HTTP(127.0.0.1:8000) + SSE 实时事件
Hono/TS 后端单体（Zod 校验 · Drizzle 数据层 · scrypt 会话认证 · AI 管线）
   │
单一 PostgreSQL（业务 + 聊天，schema 由 drizzle-kit 迁移管理）
```

聊天层为自建实现（2026-09-02 切流）：消息落库 → SSE fanout（携 DB id + client_msg_id 双去重键）→
内联 AI 闸门（意图识别/归属判定/确认卡）。OpenIM 已退役（容器停止保留观察期，详见交接文档）。

## 代码结构（npm workspaces monorepo）

```text
im-ai-office/
├── package.json               # workspaces: backend-ts / frontend-ts / electron
├── backend-ts/                # TS 后端（Hono + Zod + Drizzle + pg + Vitest）
│   ├── src/index.ts           # 入口（8000 端口，静态托管 web/ + 提醒调度）
│   ├── src/app.ts             # 路由链式组装 + export type AppType（Hono RPC 契约）
│   ├── src/pipeline.ts        # AI 编排：意图识别(Zod) → 归属判定 → 落库
│   ├── src/auth.ts            # scrypt 口令 + session token（30 天）
│   ├── src/db/schema.ts       # Drizzle schema（16+ 表，生产库内省基线）
│   ├── src/db.ts              # initSchema = drizzle migrate + 种子
│   ├── drizzle/               # 迁移（0000 audit 对齐 → 0001 聊天层新表…）
│   ├── src/routes/            # auth / messages(发送+会话+未读) / tasks / rbac / memory / misc / extra
│   ├── e2e/                   # acceptance 12 项 Vitest E2E（打真实环境）
│   └── scripts/               # import-openim.mts（Mongo 一次性导入）/ set-password.mts（口令分发）
├── frontend-ts/               # 原生 TS 前端（esbuild 单文件打包到 web/）
│   ├── src/api.ts             # API 层（hc<AppType> Hono RPC + Bearer 会话，无 @ts-nocheck）
│   ├── src/app.ts             # UI 逻辑（DOM 欠账 @ts-nocheck 渐进收紧）
│   ├── src/__sentinel__/      # RPC 契约哨兵测试（拼错端点/方法 → 编译失败）
│   └── static/                # index.html / styles.css 单一来源
├── electron/                  # Electron 桌面壳（2026-09-02 替代 Tauri）
│   ├── src/main.ts            # 窗口 / 托盘未读 / SSE 通知桥 / 注册表自启
│   ├── src/backend.ts         # 后端子进程：spawn / 端口预检 / crash 退避 / taskkill 进程树
│   └── release*/              # 安装包（IMAI Setup.exe，不入库）
├── web/                       # 后端静态目录（frontend-ts 构建产物）
├── scripts/quality-report.mjs # 识别质量周报（/api/stats/quality 客户端）
└── docs/                      # 计划与 Spec（含《统一技术栈架构演进Spec.md》）
```

## 快速开始

### 1. 依赖

- Node 22+（本机 26）、PostgreSQL 16（Windows 原生 `C:\imai\pgsql`，或任意 PG 实例）

### 2. 安装与建表

```bash
npm install                # workspaces 一次装全
cd backend-ts
npx drizzle-kit migrate    # 空库自动建全表（迁移由 journal 管理）
```

### 3. 启动

```bash
# 开发：后端
npm run dev:backend        # 等价 cd backend-ts && npx tsx src/index.ts
# 开发：前端（改动实时打包到 web/）
npm run dev:frontend

# 桌面端（推荐）：Electron 自动拉起后端
npm run dev:electron
# 打包 Windows 安装包
cd electron && npx electron-builder --win
```

浏览器模式：直接访问 `http://127.0.0.1:8000`（Electron 壳加载的就是同一页面）。

### 4. 登录

`/api/auth/login`（username + password → session token，30 天）。
账号口令由管理员用 `cd backend-ts && npx tsx scripts/set-password.mts <username> <password> [user_id]` 分发。

## 环境变量（仓库根 .env，永不提交）

| env | 作用 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串（默认 `postgresql://imai:imai_secret@127.0.0.1:5432/imai`） |
| `LLM_BASE` / `LLM_API_KEY` / `LLM_MODEL` | LLM provider（DeepSeek 兼容；v4-flash 为推理型输出，max_tokens 需 ≥4096） |
| `IMAI_ADMIN_TOKEN` | 角色设置/审批决定需带 `X-IMAI-Admin-Token` 头（未设置=放行+WARN） |
| `IMAI_LOGIN_PASSWORD` | 已废弃（P3 改 per-user scrypt 认证） |
| `AUTH_TOKEN` | 已废弃（OpenIM 回调随 P3 切流下线） |
| `OPENIM_API` / `OPENIM_SECRET` | 仅切流前使用，切流后可从 .env 移除 |

## 测试

```bash
cd backend-ts
npx vitest run                          # 单元守卫 17 项（imai_test 库，fake LLM）
IMAI_E2E_BASE=http://localhost:8000 npx vitest run --config vitest.e2e.config.ts
                                        # acceptance 12 项 E2E（真实 LLM + 生产库，标记 e2e 自动清理）
node ../scripts/quality-report.mjs      # 识别质量周报（只读）
```

测试约定：E2E 文本用「房间号/编号」等自然尾缀保证唯一（避开 30 分钟确定性去重窗口）；
数据标记 `张敏(e2e)` / `e2e-*`，跑完自动清理。

## OpenIM（已退役）

2026-09-02 切流自建聊天层后，OpenIM 不再参与任何链路。历史容器仅 `docker stop` 保留
2–4 周观察期（回滚窗口，见交接文档），届时 compose 移除 + prune。历史代码见
git tag `python-backend-final`（Python 时代）与 `openim-era-final`（OpenIM 时代终态）。

## 关键设计决策

| 决策 | 原因 |
|---|---|
| SSE 而非 WebSocket | 聊天=推送+HTTP 发送+断线拉历史，SSE 已验证够用，省去连接管理/心跳/鉴权一类复杂度 |
| 消息唯一渲染权威 = DB | 本地回显 → SSE 回声 → 历史重建三层去重（client_msg_id + db_id），重连全量刷新兜底 |
| UNIQUE(conv_id, client_msg_id) | 并发去重最终防线（check-then-insert 历史踩坑根因模式） |
| app_user.id 复用 OpenIM userID | 历史 message.sender_id / task.creator / role.oim_user_id 天然对齐，禁另起 id 体系 |
| LLM 唯一锚点 getLlm() | 服务层禁直连 provider；测试 setLlmImpl 注入；max_tokens ≥4096（v4-flash 推理型输出） |
| esbuild 依赖全内联 | 后端 dist/index.js 单文件运行仅需 node，Electron 分发不打包 node_modules |
