## 对话式 AI 办公 · MVP 项目骨架

> 内部自用 · 本地部署目标 · MVP 用云端 LLM 跑通 · TypeScript/Hono（2026-09-02 全量重写）

## 架构一句话

```
OpenIM(单独部署) --Webhook 回调--> 后端(Hono/TS，UI 数据面内聚) --> AI 识别/消歧/确认卡 → 看板/提醒
                                              |
               Postgres/SQLite + Redis + LLM Provider(云端/本地可切换)；前端经 SSE 收实时消息、REST 代发消息（无独立网关进程）
```

## 代码分层（2026-08-27 Step1 拆层重组）

```text
app.py                     兼容入口：python3 app.py / uvicorn app:app
imai/
├── config.py              配置与环境常量、进程内 EVENTS 单例
├── db.py                  SQLite 连接与建表（种子：两个小张消歧场景）
├── repos.py               数据访问（SQL 集中）
├── services/
│   ├── pipeline.py        AI 编排：意图判定→归属判定→落库（测试 mock 锚点）
│   ├── tasks.py           任务确认/驳回流转
│   ├── rbac.py            角色/高风险审批/审计语义
│   ├── memory.py          团队记忆：术语/群简介/注入/溯源/修正沉淀
│   └── ai_dm.py           AI 私聊会话 + 歧义回复收敛
├── integrations/
│   ├── llm_provider.py    OpenAI 兼容 LLM 调用（云端/本地只换配置）
│   └── openim_client.py   OpenIM 消息回写（唯一实现）
└── api/                   FastAPI 路由组装(create_app)，对外路径零变化
tests/guard + tests/eval   回归安全网（26 断言 ≤0.2s；Eval 首轮基线 19/20，见《回归加固Spec.md》）
```

> ⚠️ **桌面打包（2026-09-02 起 Electron）**：`electron/` 壳（托盘/通知/自启/后端生命周期），
> 打包 `npm run build:electron && npx electron-builder --win`；Tauri 已退役（desktop/ 删除）

## 组成

| 目录 | 说明 |
|---|---|
| `services/oim-webhook` | 接收 OpenIM 消息回调，转发到 Redis Streams |
| `services/ai-agent` | 核心 AI：意图判定 / 归属判定 / 执行 / LLM(provider 抽象) |
| `services/board-api` | 任务 / 看板 REST API |
| `services/reminder` | 到期扫描 + 提醒调度 |
| `services/auth` | RBAC 授权 |
| `domain/` | schema.sql + 事件定义 |

## 安全配置（Step4，均可选）

| env | 作用 | 未设置时 |
|---|---|---|
| `IMAI_ADMIN_TOKEN` | 角色设置/审批决定需带 `X-IMAI-Admin-Token` 头 | 无鉴权 + WARN |
| `IMAI_LOGIN_PASSWORD` | 登录需共享口令 | 匿名登录 + WARN |
| `AUTH_TOKEN` | `/callback` 需带 `X-IMAI-Token` 头 | 回调放行 + WARN |
| `IMAI_ALLOWED_ORIGINS` | CORS 白名单 | 默认桌面端+本地开发源 |
| `IMAI_AI_MODE` | `async` 启用 Redis 事件化 AI（见《事件化异步Spec.md》） | sync |
| `DATABASE_URL` | Postgres 连接串（设置且无 IMAI_DB 时启用） | SQLite |

⚠️ 桌面打包已改 Electron（`electron/`，实测全绿）；tauri 相关条目作废。

## 快速开始

### 1. 启动基础依赖（Postgres + Redis）

```bash
docker compose up -d postgres redis
```

### 2. 初始化数据库

```bash
docker compose exec -T postgres psql -U imai -d imai -f /schema.sql
```

### 3. 启动 AI 服务

> ⚠️ 本节为旧架构描述。**当前实际启动方式（2026-08-31 起）**：
> - 开发：`powershell -File scripts\dev.ps1`（uvicorn --reload + web 同步监听）
> - 无头：`python cli.py up / status / down`
> - 自启开关：`powershell -File scripts\autostart.ps1 -Action enable|disable|status`
>   （默认 **OFF** 不自启；enable 后注册当前用户登录计划任务「IMAI Autostart」，
>   由 `scripts/start-silent.ps1` 静默拉起后端，不含 OpenIM server）

```bash
# 本地 LLM 之前用云端，配置见 .env（OPENAI_API_KEY 或自建兼容端点）
cd services/ai-agent
pip install -r requirements.txt
python main.py
```

### 4. 联调 OpenIM（单独部署）

> ⚠️ 旧架构容器组（oim-webhook / ai-agent / board-api / reminder）已于 2026-08-28 下线，
> compose 中标记为 `profiles: ["legacy"]`，默认不再启动；需要考古时
> `docker compose --profile legacy up -d <服务名>`。



OpenIM 用官方方式单独部署（服务端全家桶较重），把你部署的 OpenIM 回调 URL 指向 `oim-webhook`：

- OpenIM 回调配置：开启 `afterSendSingleMsg` / `afterSendGroupMsg` 等消息事件，回调地址填 `http://<oim-webhook>:8100/callback`
- 具体配置见 OpenIM 官方文档（Callback 配置）

## 环境变量

见 `.env.example`。关键：
- `LLM_API_KEY` / `LLM_BASE`：LLM provider（MVP 用云端，之后切本地部署，只改 provider 配置）
- `DATABASE_URL` / `REDIS_URL`：Postgres 与 Redis
- `AUTH_TOKEN`：OpenIM → oim-webhook 回调鉴权

## OpenIM 接入指南（真实群聊跑进来）

> 需要 **docker 环境**（OpenIM 服务端是容器化全家桶：etcd/mongo/redis/api/rpc）。
> 下面 5 步把真实群聊接入我们的闭环。代码已备好，仅需配环境。

### 1. 部署 OpenIM 服务端
用官方 Docker Compose 部署 open-im-server（server/api/rpc 全套），得到：
- `API_ADDRESS`：OpenIM API 地址（如 `http://localhost:10002`）
- 管理端 `token`（admin secret，可在部署时配置）

```bash
# 参考官方 docker-compose 部署 OpenIM
```

### 2. 配置群消息回调 → 指向 oim-webhook
在 OpenIM 配置里设置**回调 URL** 并开启对应协议开关：
- 回调 URL：`http://<oim-webhook>:8100/callback`
- 开启：`afterSendGroupMsg`（群消息发送后）
- 方向：OpenIM Server → 我们 oim-webhook（HTTP POST）

### 3. oim-webhook 接收解析 → 写 Redis Streams
`services/oim-webhook/main.py` 已做好 OpenIM 回调解析（抽取 msgID/groupID/sendID/content），转发到 `msg` 流。

### 4. ai-agent 消费 → 识别 → 归属 → 落库
`services/ai-agent/main.py` 消费 `msg` 流，调 `intent.py`/`assign.py` 识别任务、消歧、落库。

### 5. AI 回写群消息（确认卡 / 提醒 / 私聊消歧）
`services/ai-agent/openim_client.py` 封装 OpenIM `POST /msg/send_msg`：
- `send_group_notice()` → 群里发确认卡/提醒（`sessionType=3`）
- `send_private_confirm()` → 私聊发送者做消歧确认（`sessionType=1`）

需要环境变量：
```bash
OPENIM_API=http://localhost:10002
OPENIM_ADMIN_TOKEN=<admin token>
```

### 联调自测（单点验证）
部署后可用 curl 直接调 OpenIM 发消息接口，确认回调链路通：
```bash
# 在 OpenIM 发一条群消息 → 观察 oim-webhook 日志 → ai-agent 是否有 intent 输出
```

## 本地（无 Docker）说明
后端已全量迁移至 TypeScript（`backend-ts/`，Hono + Zod + postgres.js，2026-09-02）：
```bash
cd backend-ts && npm install
DATABASE_URL="postgresql://imai:imai_secret@127.0.0.1:5432/imai" npx tsx src/index.ts   # 8000 端口
npx vitest run   # 守卫测试（连 imai_test 库）
```
OpenIM 接入只需在有 docker 的机器上补「部署 + 配回调」两步，其余代码逻辑复用。

## 环境变量

见 `.env.example`。关键：
- `LLM_API_KEY` / `LLM_BASE`：LLM provider（MVP 用云端，之后切本地部署，只改 provider 配置）
- `DATABASE_URL` / `REDIS_URL`：Postgres 与 Redis
- `AUTH_TOKEN`：OpenIM → oim-webhook 回调鉴权
- `OPENIM_API` / `OPENIM_ADMIN_TOKEN`：AI 回写群消息用

```text
im-ai-office/
├── docker-compose.yml
├── .env.example
├── domain/
│   ├── schema.sql
│   └── events/events.md        # 事件协议说明
└── services/
    ├── oim-webhook/
    ├── ai-agent/
    ├── board-api/
    ├── reminder/
    └── auth/
```
