# IMAI · 对话式 AI 办公助手

> 内部自用 · 单机部署 + Tailscale 跨区域团队接入 · TypeScript 全栈（Hono + Drizzle + Electron）· 零 Docker / 零 Python / 零 Rust 工具链

## 它是什么

群聊里说“XX 下午写个报告”，AI 自动识别任务 → 确认卡找人拍板 → 看板跟进 → 到期提醒 → 完成闭环。
界面为 UI 骨架 v2：左侧导航七视图（聊天/任务工作台/审批/记忆/汇总/权限/设置）、AI 统一卡片语言、三态存在规则、浅深双主题、记忆页拟人化。
团队成员分布不同区域也能用：主机 + 全员装 Tailscale（免费加密组网）即可，见[团队部署](#团队部署tailscale-跨区域)。

## 架构一句话

```
Electron 壳（托盘/系统通知/开机自启/后端子进程生命周期）
   │ HTTP(127.0.0.1:8000) + SSE 实时事件
Hono/TS 后端单体（Zod 校验 · Drizzle 数据层 · scrypt 会话认证 · AI 管线）
   │
单一 PostgreSQL（业务 + 聊天，schema 由 drizzle-kit 迁移管理）
```

聊天层为自建实现（2026-09-02 切流）：消息落库 → SSE fanout（携 DB id + client_msg_id 双去重键）→
内联 AI 闸门（意图识别/归属判定/确认卡）。OpenIM 已退役并物理下线（2026-09-03，详见交接文档）。

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
│   ├── src/app.ts             # UI 逻辑（导航七视图/工作台/卡片系统，tsc 0 错误）
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

### 团队部署（Tailscale 跨区域）

成员不在同一局域网时，主机与全员各装 [Tailscale](https://tailscale.com)（免费加密组网）并登录同一账号，
浏览器访问主机虚拟 IP（如 `http://100.x.y.z:8000`）即可，数据端到端加密、零公网暴露。
方案与风险详见 `docs/specs/团队分布式部署Tailscale-Spec.md`，同事接入三步见 `docs/同事接入说明书.md`。
完整方案（含局域网直连模式）见 `交接文档.md` 部署章节。

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
npx vitest run                          # 单元守卫 23 项（G11-G18 + parser，imai_test 库，fake LLM）
IMAI_E2E_BASE=http://localhost:8000 npx vitest run --config vitest.e2e.config.ts
                                        # acceptance 12 项 E2E（真实 LLM + 生产库，标记 e2e 自动清理）
node ../scripts/quality-report.mjs      # 识别质量报告（含真实口径通过率/分源延迟，只读）
```

测试约定：E2E 文本用「房间号/编号」等自然尾缀保证唯一（避开 30 分钟确定性去重窗口）；
数据标记 `张敏(e2e)` / `e2e-*`，跑完自动清理。

## OpenIM（已退役）

2026-09-02 切流自建聊天层，OpenIM 不再参与任何链路；2026-09-03（Task 3.7）全部容器、镜像与数据卷已物理删除，Docker 不再是运行依赖。历史代码见
git tag `python-backend-final`（Python 时代）与 `openim-era-final`（OpenIM 时代终态）。

## 关键设计决策

| 决策 | 原因 |
|---|---|
| SSE 而非 WebSocket | 聊天=推送+HTTP 发送+断线拉历史，SSE 已验证够用，省去连接管理/心跳/鉴权一类复杂度 |
| 消息唯一渲染权威 = DB | 本地回显 → SSE 回声 → 历史重建三层去重（client_msg_id + db_id），重连全量刷新兜底 |
| UNIQUE(conv_id, client_msg_id) | 并发去重最终防线（check-then-insert 历史踩坑根因模式） |
| app_user.id 复用 OpenIM userID | 历史 message.sender_id / task.creator / role.oim_user_id 天然对齐，禁另起 id 体系 |
| LLM 唯一锚点 getLlm() | 服务层禁直连 provider；测试 setLlmImpl 注入；max_tokens ≥4096（v4-flash 推理型输出） |
| AI 三态规则 | 主动态（角标+卡片找人）/工作态（轻提示不弹窗）/静默态（隐形）——每个 AI 功能必须归属其一，防“为存在感而吵” |
| 别名最长匹配优先 | 归属判定子串匹配时，长命中覆盖短别名（“小张为”不被短别名“小张”扩成多人歧义，G18） |
| 静态资源 no-cache + 构建时间戳指纹 | 启发式磁盘缓存曾致 Electron 更新后仍跑旧 JS（SSE 自愈代码加载不到） |
| esbuild 依赖全内联 | 后端 dist/index.js 单文件运行仅需 node，Electron 分发不打包 node_modules |
