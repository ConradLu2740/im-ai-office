# OpenIM 真实群聊接入 Spec

> 目标：把 OpenIM 服务端的真实群消息接入 IMAI 办公助手，实现「群里说话 → AI 旁听识别 → 任务确认 → 看板」的完整闭环。

---

## 1. 当前状态

> 2026-08-23 核对：以下基于本机实测（Colima VM，OpenIM 3.8.3；本机内网 IP=10.242.13.30）。区分「桌面端链路」与「服务端 docker 架构」两条线。

| 组件 | 状态 |
|---|---|
| 桌面应用（Tauri + Web UI） | ✅ 已可用，含消息/看板界面（登录/会话/群聊收发已接入） |
| Python 后端（app.py + core.py） | ✅ 已可用，DeepSeek LLM 接入 |
| SQLite 任务存储 | ✅ 已可用 |
| 手动/模拟消息测试 AI 闭环 | ✅ 已验证（识别→落库→上板→确认全通） |
| OpenIM 服务端部署 | ✅ 运行中（openim-server 3.8.3-patch.15，容器 healthy） |
| OpenIM 回调 → app.py `/callback` | ✅ 已配对（webhooks.yml URL=本机 10.242.13.30:8000/callback；afterSendGroupMsg/afterSendSingleMsg 均 enable；路由响应正常） |
| 桌面端实时收/发（msg_gateway） | ✅ 已通（Node sidecar 8400，双工收/发） |
| `oim-webhook`/`ai-agent` 容器链路 | 🔶 容器在运行，但该 Redis Streams 备用架构非桌面端主链路（未端到端验证消费） |
| 私聊发送者确认归属 | 🔶 客户端 `send_confirm_card` 已有；端到端触发依赖真实回调，待完整验证 |

---

## 2. 接入目标

1. OpenIM 群里任何人发消息，AI 都能**旁听**。
2. AI 判断消息中包含任务安排时，在桌面应用右侧看板生成一条**待确认任务**。
3. 当负责人存在歧义（如多个"小张"），AI **私聊发送者**，让其点击确认具体人选。
4. 发送者在私聊里确认后，任务状态变为**已确认**，并进入看板。
5. 整个流程**不需要群里的人手动 @AI**，AI 默认开启旁听。

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenIM 服务端                             │
│  (etcd / mongo / redis / api / rpc / msg_gateway)               │
└──────────────┬──────────────────────────────────────────────────┘
               │ afterSendGroupMsg / afterSendSingleMsg 回调
               ▼
┌─────────────────────────┐      ┌─────────────────────────┐
│   services/oim-webhook  │ ───▶ │        Redis Streams    │
│   (FastAPI 接收回调)     │      │        (imai:events)    │
└─────────────────────────┘      └──────────┬──────────────┘
                                            │
               ┌────────────────────────────┘
               ▼
┌─────────────────────────┐      ┌─────────────────────────┐
│   services/ai-agent     │ ───▶ │   services/board-api    │
│   (意图/归属/执行)        │      │   (任务/看板 REST API)   │
└──────────┬──────────────┘      └─────────────────────────┘
           │
           ▼ 私聊确认
┌─────────────────────────┐
│   OpenIM 单聊发送 API    │
└─────────────────────────┘
```

---

## 4. 数据流详解

### 4.1 群里发消息

1. 用户在 OpenIM App 里进入群「产品讨论组」，发送消息。
2. OpenIM 服务端触发 `afterSendGroupMsg` 回调，POST 到：
   ```
   http://<oim-webhook-host>:8100/callback
   ```
3. `oim-webhook` 解析消息，写入 Redis Streams：
   ```json
   {
     "event": "group_msg",
     "group_id": "xxx",
     "group_name": "产品讨论组",
     "sender_id": "user_001",
     "sender_name": "张敏",
     "content": "小张 你来跟进这个方案，周五前给我",
     "content_type": 101,
     "send_time": 1692758400000
   }
   ```

### 4.2 AI 消费并识别

1. `ai-agent` 监听 Redis Streams，读取 `group_msg` 事件。
2. 调用 `core.process_message(content, sender_name)` 进行意图识别。
3. 识别结果分三种情况：

#### 情况 A：不是任务
- AI 静默跳过，不落库。

#### 情况 B：任务 + 归属无歧义
- AI 直接调用 `board-api` 创建任务，状态 `pending_confirmation`。
- 桌面应用轮询到看板更新。

#### 情况 C：任务 + 归属有歧义
- AI 不直接落任务，改为给**发送者**发一条单聊消息。
- 单聊消息内容是一个「确认卡片」：
  ```
  你刚说"小张 你来跟进这个方案"，系统检测到多位"小张"：
  1. 张伟（产品经理）
  2. 张敏（市场专员）
  请点击确认具体负责人。
  ```
- 发送者回复编号或点击按钮后，AI 再创建任务。

### 4.3 私聊确认机制

由于 OpenIM 不支持复杂交互卡片，私聊确认采用**文本指令**：

```
【IMAI 任务确认】
消息："小张 你来跟进这个方案，周五前给我"
检测到的负责人候选：
1. 张伟（产品经理）
2. 张敏（市场专员）
请回复数字确认，或回复"取消"。
```

发送者回复 `1`，AI 识别为确认张伟，创建任务：
```json
{
  "content": "跟进这个方案，周五前给我",
  "assignee": "张伟",
  "deadline": "周五前",
  "status": "confirmed"
}
```

---

## 5. 关键接口/事件

### 5.1 OpenIM 回调配置

在 `open-im-server/config/webhooks.yml` 中配置：

```yaml
webhooks:
  url: "http://<oim-webhook>:8100/callback"
  afterSendGroupMsg:
    enable: true
  afterSendSingleMsg:
    enable: true
  beforeSendGroupMsg:
    enable: false
```

### 5.2 oim-webhook 接收格式

OpenIM 3.8 回调请求体示例：

```json
{
  "sendID": "user_001",
  "groupID": "group_xxx",
  "senderNickname": "张敏",
  "contentType": 101,
  "content": "小张 你来跟进这个方案，周五前给我",
  "seq": 123,
  "sendTime": 1692758400000
}
```

### 5.3 Redis Streams 事件格式

```json
{
  "event": "group_msg",
  "group_id": "group_xxx",
  "group_name": "产品讨论组",
  "sender_id": "user_001",
  "sender_name": "张敏",
  "content": "小张 你来跟进这个方案，周五前给我",
  "content_type": 101,
  "send_time": 1692758400000
}
```

### 5.4 board-api 创建任务接口

```http
POST /api/tasks
Content-Type: application/json

{
  "content": "跟进这个方案，周五前给我",
  "creator": "张敏",
  "assignee": "张伟",
  "deadline": "周五前",
  "source_msg": "小张 你来跟进这个方案，周五前给我",
  "group_id": "group_xxx"
}
```

响应：
```json
{
  "id": 5,
  "status": "pending_confirmation"
}
```

### 5.5 OpenIM 发送单聊消息

调用 OpenIM REST API：

```http
POST /msg/send_msg
Content-Type: application/json
Authorization: Bearer <admin_token>

{
  "sendID": "imai_assistant",
  "recvID": "user_001",
  "senderNickName": "AI 助手",
  "contentType": 101,
  "content": "【IMAI 任务确认】..."
}
```

---

## 6. 实施步骤

### Step 1：重新部署/拉起 OpenIM 服务端
- 本机 Docker 拉起，或部署到测试服务器
- 记录 API 地址 `OPENIM_API_ADDRESS` 和 admin token

### Step 2：启动 oim-webhook
- 实现/修复 `services/oim-webhook/main.py`
- 接收 OpenIM 回调，解析消息，写入 Redis Streams
- 监听端口 `8100`

### Step 3：配置 OpenIM 回调
- 修改 `webhooks.yml`
- 重启 OpenIM 服务端或热重载配置

### Step 4：实现 ai-agent 群消息消费
- 监听 Redis Streams
- 调用 `core.process_message()`
- 根据结果调用 board-api 或 OpenIM 单聊 API

### Step 5：扩展 board-api
- 添加 `POST /api/tasks` 创建任务接口
- 添加 `source_msg`、`group_id` 字段
- 桌面应用轮询 `/api/tasks` 自动刷新

### Step 6：私聊确认闭环
- ai-agent 识别歧义时发送单聊消息
- 接收 `afterSendSingleMsg` 回调
- 解析用户回复，创建/更新任务

### Step 7：端到端验证
- 在 OpenIM App 里建群、拉人、发消息
- 验证桌面应用看板自动出现任务
- 验证歧义时发送者收到私聊确认

---

## 7. MVP 范围裁剪

第一阶段只做：
- ✅ 群消息旁听 + 任务识别 + 看板
- ✅ 归属无歧义直接落库
- ⚠️ 归属歧义时私聊确认（先做文本指令版，不做按钮卡片）
- ❌ 到期提醒（下一版）
- ❌ RBAC 权限（下一版）
- ❌ 团队记忆（下一版）

---

## 8. 验收标准

| 验收项 | 标准 |
|---|---|
| 群消息触发 | 在 OpenIM 群里发一条任务消息，10 秒内桌面看板出现待确认任务 |
| 非任务消息 | 发"今天天气怎么样"，看板不出现任务 |
| 歧义处理 | 发"小张 你来跟进方案"，发送者收到 AI 私聊确认 |
| 私聊确认 | 发送者回复编号后，任务变为已确认并进入看板 |
| 桌面应用 | 全程无需重启桌面应用，看板自动刷新 |

---

## 9. 风险与依赖

| 风险 | 应对 |
|---|---|
| OpenIM 部署复杂 | 优先 Docker Compose 本机拉起，或复用之前验证过的配置 |
| 回调地址网络不通 | oim-webhook 和 OpenIM 需在同一网络；若分机器需公网/内网穿透 |
| OpenIM API 版本差异 | 以 OpenIM 3.8 为准，调用前先做接口探测 |
| LLM 额度 | 已切 DeepSeek，需保证 key 有余额 |

---

## 10. 交付物

- 更新后的 `services/oim-webhook/`
- 更新后的 `services/ai-agent/`
- 更新后的 `services/board-api/`
- 桌面应用重新打包（看板自动刷新已支持）
- 部署/配置文档更新
