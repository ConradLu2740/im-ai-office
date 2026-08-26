## 对话式 AI 办公 · MVP 项目骨架

> 内部自用 · 本地部署目标 · MVP 用云端 LLM 跑通 · Python/FastAPI

## 架构一句话

```
OpenIM(单独部署) --Webhook--> oim-webhook --Redis Streams--> ai-agent --LLM--> 产出
                                                                   |
                                            board-api(任务/看板) + reminder(提醒) + auth(RBAC)
                                            共用 Postgres
```

## 组成

| 目录 | 说明 |
|---|---|
| `services/oim-webhook` | 接收 OpenIM 消息回调，转发到 Redis Streams |
| `services/ai-agent` | 核心 AI：意图判定 / 归属判定 / 执行 / LLM(provider 抽象) |
| `services/board-api` | 任务 / 看板 REST API |
| `services/reminder` | 到期扫描 + 提醒调度 |
| `services/auth` | RBAC 授权 |
| `domain/` | schema.sql + 事件定义 |

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

```bash
# 本地 LLM 之前用云端，配置见 .env（OPENAI_API_KEY 或自建兼容端点）
cd services/ai-agent
pip install -r requirements.txt
python main.py
```

### 4. 联调 OpenIM（单独部署）

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
当前沙箱无 docker，**AI 业务闭环已用 `core.py` + FastAPI + 真实 LLM 跑通**（见 `app.py`/`index.html`/`demo_pipeline.py`）。
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
