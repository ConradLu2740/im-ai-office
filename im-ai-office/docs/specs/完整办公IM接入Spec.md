# 完整 AI 办公 IM 接入 Spec

> 目标：把 OpenIM 客户端能力（登录、聊天、消息同步）做进 IMAI 办公助手桌面应用，实现"一个 App = 办公 IM + AI 旁听 + 任务看板"。

---

## 1. 当前状态

> 2026-08-23 更新：接入层已实际打通（登录/会话/群聊收发/实时同步均已可用），本表已同步真实进度。

| 组件 | 状态 |
|---|---|
| Tauri 桌面应用 | ✅ 已可用，有 IM 风格 UI |
| SQLite 后端（app.py/core.py） | ✅ 已可用，含 AI 识别 + 任务落库 |
| OpenIM 服务端 | ✅ 已在本地 Colima/Docker 运行（v3.8.3-patch.15） |
| OpenIM 回调 → AI 处理 | ✅ 已配置 |
| 桌面应用内登录 | ✅ 已接入（须用普通用户 user001/002/003；imAdmin 为管理账号，不能登录） |
| 桌面应用内会话列表 | ✅ 已接入（AI助手/群/单聊） |
| 桌面应用内群聊收发 | ✅ 已接入（经 Node sidecar 网关 8400，双工收发） |
| 实时消息同步 | ✅ 已接入（OnRecvNewMessages 推送 + /gw/poll 增量拉取） |
| 任务看板 | ✅ 已可用（待指派/待确认/已确认 三列） |
| AI 旁听识别 | ✅ 已可用（模拟/真实群消息 → 识别→落库→上板） |

---

## 2. 总体架构

```
┌─────────────────────────────────────────────┐
│         IMAI 办公助手（Tauri 桌面应用）        │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 登录/注册 │  │ 聊天会话  │  │ 任务看板   │  │
│  └────┬────┘  └────┬─────┘  └─────┬─────┘  │
│       │            │              │        │
│       └────────────┴──────────────┘        │
│                    │                        │
│              WebView 前端                   │
│                    │ invoke / fetch         │
│              Rust 后端壳                    │
└────────────────────┬────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
  OpenIM REST  OpenIM WS   Python app.py
     API        (实时消息)   (AI + 看板)
        │            │            │
        └────────────┴────────────┘
                     │
              OpenIM 服务端
```

---

## 3. 用户流程

### 3.1 首次使用

1. 用户双击打开 `IMAI办公助手.app`
2. 自动启动本地 Python 后端
3. 显示登录界面：账号 + 密码
4. 用户输入 OpenIM 账号密码，点击登录
5. 登录成功后进入主界面：左侧会话列表 + 中间聊天区 + 右侧看板

### 3.2 聊天

1. 用户点击已有会话，或点击"新建群聊"
2. 在输入框打字，按回车发送
3. 消息通过 Rust 壳调用 OpenIM REST API 发送
4. OpenIM 把消息推送给群成员
5. 同时 OpenIM 触发回调到 `app.py`
6. `app.py` 调用 AI 识别，更新看板

### 3.3 AI 旁听

- 群聊中任何人发消息，AI 默认旁听
- 识别到任务 → 看板出现待确认/待指派任务
- 归属歧义 → AI 助手私聊发送者确认
- 发送者在同一个桌面应用里收到 AI 助手私聊，回复数字

---

## 4. 技术方案

### 4.1 OpenIM 客户端接入方式

有两个选择：

#### 方案 A：纯 REST + WebSocket（推荐 MVP）

- 用 OpenIM REST API 做：登录、获取会话列表、获取历史消息、发送消息
- 用 OpenIM WebSocket 做：实时接收新消息
- 优点：简单、可控、不需要引入 OpenIM SDK
- 缺点：需要自己做消息状态管理

#### 方案 B：集成 OpenIM Web SDK

- OpenIM 提供 Web SDK (`open-im-sdk-web`)
- 在前端直接初始化 SDK，连接 OpenIM 服务端
- 优点：功能完整，消息同步由 SDK 处理
- 缺点：SDK 体积大，与 Tauri 集成可能有兼容性 issues

**MVP 选方案 A**：REST + 短轮询/长轮询 + WebSocket。

### 4.2 Rust 侧新增能力

Tauri 后端需要新增命令：

```rust
openim_login(account, password) -> Result<UserToken, Error>
openim_get_conversations(token) -> Result<Vec<Conversation>, Error>
openim_get_messages(token, conversation_id, seq) -> Result<Vec<Message>, Error>
openim_send_message(token, conversation_id, content) -> Result<(), Error>
openim_connect_ws(token) -> Result<(), Error>
```

HTTP 请求用 `reqwest`，WebSocket 用 `tokio-tungstenite`。

### 4.3 Python 后端调整

- `app.py` 继续负责 AI 识别和看板
- 不需要大改，当前 `/callback` 已经能接收 OpenIM 回调
- 需要确保回调里的 `sendID` 和桌面应用登录用户一致

### 4.4 前端界面调整

当前前端已经有 IM 风格界面，需要增强：

1. **登录页**：新加一个登录页面，未登录时显示
2. **会话列表**：从静态数据改为真实 OpenIM 会话
3. **聊天区**：
   - 显示真实历史消息
   - 发送消息后本地先渲染，再调用 API
   - 收到新消息自动追加
4. **AI 助手会话**：作为系统会话显示在列表中

---

## 5. API 接口清单

### 5.1 登录

```http
POST http://127.0.0.1:10002/auth/user_token
Content-Type: application/json

{
  "secret": "openIM123",
  "platformID": 10,
  "userID": "user001"
}
```

> 注意：OpenIM 3.8 登录方式可能不同，需要先探测 `/auth/user_token` 或 `/user/login`。

### 5.2 获取会话列表

```http
POST /conversation/get_conversations_list
Content-Type: application/json
operationID: xxx
token: {user_token}

{
  "ownerUserID": "user001",
  "pagination": {"pageNumber": 1, "showNumber": 100}
}
```

### 5.3 获取历史消息

```http
POST /msg/get_msgs
Content-Type: application/json
operationID: xxx
token: {user_token}

{
  "userID": "user001",
  "conversationID": "sg_group001",
  "count": 20,
  "startClientMsgID": ""
}
```

### 5.4 发送消息

```http
POST /msg/send_msg
Content-Type: application/json
operationID: xxx
token: {user_token}

{
  "sendID": "user001",
  "groupID": "group001",
  "senderNickname": "张敏",
  "content": {"content": "小张 你来跟进这个方案"},
  "contentType": 101,
  "sessionType": 3
}
```

| 5. 收消息 | 轮询 REST API 获取新消息 |
| 6. 发消息 | 管理员 API 代发，sender 显示为当前登录用户 |
| 7. 看板 | 保持现有轮询逻辑 |

### 5.5 WebSocket 连接（可选增强）

```
ws://127.0.0.1:10001?sendID=xxx&token=xxx&platformID=5
```

MVP 先不做 WebSocket，用 3 秒轮询代替。

---

## 6. 实施步骤

### Step 1：探测 OpenIM API

- 确认登录接口（`user_token` vs `login`）
- 确认获取会话、消息、发送消息的准确请求体
- 确认 WebSocket 连接方式

### Step 2：Rust 后端封装 OpenIM 客户端

- 添加 `reqwest` 依赖（已有）
- 添加 `tokio-tungstenite` 依赖
- 实现 `openim_login`、`openim_get_conversations`、`openim_get_messages`、`openim_send_message`
- 实现 WebSocket 连接和消息推送

### Step 3：前端接入

- 新增登录页面
- 会话列表调用 Rust 命令获取真实数据
- 聊天区发送/接收真实消息
- 看板保持现有轮询逻辑

### Step 4：打通端到端

- 桌面应用内发群消息
- OpenIM 回调到 `app.py`
- AI 识别，看板更新
- AI 私聊确认在同一个桌面应用内完成

### Step 5：界面打磨

- 消息气泡、头像、时间
- 未读消息数
- 发送状态（发送中/已发送/失败）

---

## 7. MVP 范围裁剪

第一阶段只做：
- ✅ 账号密码登录
- ✅ 会话列表
- ✅ 群聊消息收发
- ✅ AI 旁听 + 看板
- ✅ 私聊确认
- ❌ 注册（先用 OpenIM 已有账号或 admin 后台创建）
- ❌ 好友管理
- ❌ 文件/图片消息
- ❌ 语音/视频通话
- ❌ 已读回执

---

## 8. 验收标准

| 验收项 | 标准 |
|---|---|
| 登录 | 打开桌面应用，输入 OpenIM 账号密码，进入主界面 |
| 会话列表 | 能看到自己加入的群聊 |
| 发消息 | 在群里发消息，其他成员能在 OpenIM 客户端/桌面应用看到 |
| AI 旁听 | 发任务消息，右侧看板自动出现任务 |
| 私聊确认 | 歧义时，发送者在同桌面应用收到 AI 助手私聊，回复数字后看板更新 |
| 一个 App | 全程不需要打开 OpenIM 官方客户端 |

---

## 9. 风险

| 风险 | 应对 |
|---|---|
| OpenIM WebSocket 协议复杂 | 先实现 REST 轮询，再补 WebSocket |
| OpenIM 3.8 API 文档不全 | 通过实际接口探测 + 日志分析 |
| Tauri 与 WebSocket 集成 | 使用 Rust 侧 WebSocket，通过事件推送给前端 |
| 多用户同时登录 | MVP 只支持单用户登录 |
