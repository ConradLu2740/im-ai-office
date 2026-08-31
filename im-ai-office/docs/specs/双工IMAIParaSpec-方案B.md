# 双工 IM + AI 旁听 Spec（方案 B）

> 目标：让 IMAI 办公助手成为**真正的双工 IM**（像飞书/微信），并让 AI 旁听群聊自动识别任务。
> 核心突破：解决 WebView 连 `ws://` 被 macOS ATS 限制（network error）的问题。

---

## 1. 问题根源（已确认）

上一版在 WebView 里用 JS SDK 连 OpenIM WebSocket，报 `network error`。原因是：
- **macOS WKWebView 对 `ws://`（非 TLS WebSocket）连接有限制**，ATS 配置无法完全解除
- 我实测 `NSAllowsArbitraryLoads` 全量放开仍不行 → 确认是 WebView 能力限制，非配置问题

**结论：JS SDK 不能再在 WebView 里跑，必须改用原生网络栈。**

---

## 2. 技术选型：Node Sidecar 方案（B2）

用**一个独立的 Node 进程**跑 `@openim/client-sdk`，作为消息网关：
- Node 是独立 CLI 进程，用**原生网络栈**，不受 ATS / WebView 限制
- SDK 在 Node 里已实测 `connect SUCCESS` + 实时收消息成功
- Node 进程通过本地 HTTP/WebSocket 与桌面应用通信

```
┌─────────────────────────────────────────────┐
│         IMAI 办公助手（Tauri 桌面应用）        │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 登录/注册 │  │ 聊天会话  │  │ 任务看板   │  │
│  └─────────┘  └────┬─────┘  └─────┬─────┘  │
│                    │ localhost HTTP/WS  │   │
│              ┌─────┴──────────────┐     │   │
│              │  消息网关(Node进程)  │─────┘   │
│              │  (跑 OpenIM SDK)    │        │
│              └─────────┬──────────┘        │
└────────────────────────┼────────────────────┘
                         │ WebSocket (ws://127.0.0.1:10001)
                         ▼
                   OpenIM 服务端
```

### 为什么用 Node 不用 Rust 重写
- Node 里跑 SDK 已验证可行（connect + 收消息成功）
- 无需在 Rust 里重写 sdkws.proto 的 protobuf 编解码（工程量小、风险低）
- Rust 壳只需负责拉起/停止 Node 进程 + 转发前端请求

---

## 3. 消息网关（Node 进程）设计

### 3.1 职责
- 连接 OpenIM WebSocket（`ws://127.0.0.1:10001`）
- 登录（userID + token）
- 实时接收新消息 → 推送给桌面应用
- 发送消息（走 WebSocket）
- 心跳保活
- 同步会话列表

### 3.2 协议要点（已从 SDK 源码确认）

**连接 URL**：
```
ws://127.0.0.1:10001?v=<base64(JSON.stringify({
  userID, token, platformID:5, operationID, background:false,
  sendResponse:true, sdkType:"js"
}))>
```

**心跳**：发送文本帧 `{"type":"ping"}`

**收发消息**：protobuf 编码的帧
- 发送：`MsgData`（含 reqIdentifier = SendMsg）
- 接收：`PushMessages`（含 Msgs 数组）

### 3.3 网关通过本地 HTTP 暴露给前端

```
POST /gw/login        {userID, token}        → 连接 WS
POST /gw/send         {groupID, content}     → 发消息
GET  /gw/conversations                      → 会话列表
GET  /gw/messages?conv=...                  → 历史消息
POST /gw/close                              → 断开
```

前端调用这些，网关再转发 OpenIM。

---

## 4. 前端调整

1. **移除 JS SDK 连接逻辑**（不再在 WebView 里连 ws）
2. 前端通过 `api_call`（Rust 壳转发）调用网关的 HTTP 接口
3. 新消息展示：网关推送（或前端轮询网关 `/gw/messages`）
4. 消息发送：调 `/gw/send`

---

## 5. AI 旁听链路（不变，复用现有）

```
群里消息（网关收到）→ 后端 /api/sdk_message
  → core.process_message() AI 识别任务
  → 任务落库 → 看板更新
  → 歧义 → AI 助手私聊确认
```

---

## 6. 实施步骤

### Step 1：Node 网关进程
- 写好 `msg_gateway.js`（复用 SDK，连接 OpenIM，暴露本地 HTTP）
- 验证：node 启动后能 connect + 收消息

### Step 2：Rust 壳集成网关
- 桌面应用启动时拉起 Node 网关进程
- 退出时停止
- Rust 转发前端请求到网关

### Step 3：前端接入网关
- 替换 SDK 连接逻辑，改用网关 HTTP
- 消息收发走网关

### Step 4：端到端联调
- 桌面应用内登录 → 看到会话 → 收发消息 → AI 旁听 → 看板

---

## 7. 验收标准（双工 IM）

| 验收项 | 标准 |
|---|---|
| 登录 | 桌面应用登录后能连 OpenIM，显示真实会话 |
| 收消息 | 别人在群里发消息，桌面应用**实时**显示 |
| 发消息 | 桌面应用发消息，群里其他成员能看到 |
| AI 旁听 | 别人发的任务消息 → AI 识别 → 看板出任务 |
| 双工 | 收发消息双向实时，无需刷新 |

---

## 8. 风险

| 风险 | 应对 |
|---|---|
| Node 进程被 macOS 沙盒限制 | 独立进程不受 ATS/WKWebView 限制，仅需允许网络 |
| SDK 再次出问题 | SDK 在 Node 已实测通过；如再出问题，退级用 Rust 重写协议 |
| Node 网关与桌面应用通信 | 用 127.0.0.1 本地 HTTP，稳定 |

---

## 9. 交付物
- `desktop/msg_gateway.js`（Node 网关）
- Rust 壳逻辑（拉起/停止网关 + 转发）
- 前端改造（消息收发走网关）
- 重新打包 `.app`
