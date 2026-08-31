# 实时收消息接入 Spec

> 目标：让 IMAI 办公助手**实时收到群聊消息**，实现「别人在群里发消息 → 桌面应用即时显示 → AI 自动旁听识别 → 看板更新」的完整闭环。
> 前置：登录、会话列表、发消息、AI 识别、看板、AI 私聊确认都已跑通（见上一阶段）。

---

## 1. 问题背景

当前桌面应用的聊天能力是**单向的**：
- ✅ 能发消息（OpenIM admin API 代发）
- ✅ 发送后 AI 即时识别
- ❌ **收不到别人发的消息**（没有实时推送，REST 拉取也因 seq 机制返回空）

要实现「完整办公 IM」，必须让桌面应用能实时收到群里的消息。

---

## 2. 技术选型（含实测结论）

### 2.1 OpenIM 提供的能力

OpenIM 服务端已跑在本地（Colima/Docker）：
- **REST API**：`http://127.0.0.1:10002`
- **WebSocket（msg_gateway）**：`ws://127.0.0.1:10001`

实时收消息有两条路：

| 方案 | 说明 | 实测结论 |
|---|---|---|
| **A. OpenIM Web SDK（open-im-sdk-web）** | 官方 JS SDK，基于 wasm，负责连接/鉴权/消息推送 | ⚠️ 需 NPM 安装，wasm 在 Tauri WebView 可能有兼容性风险，需验证 |
| **B. 自建 WebSocket 客户端** | 用 Rust 或 Python 直连 OpenIM msg_gateway，按协议接收推送 | ⚠️ 握手参数（platformID int 类型解析）之前探测失败，需深入研究 |

### 2.2 已实测的问题

- OpenIM `msg_gateway` WebSocket 握手报 `platformID is not int`：query string 天然是字符串，OpenIM 端 `strconv.Atoi` 解析失败。**说明握手协议需要 SDK 级兼容，或需要特定参数编码。**
- `POST /msg/pull_msg_by_seq` 返回空 `data:{}`：因为会话 seq 索引需要客户端先通过 WS 同步才能建立。
- 普通用户 token 调 `send_msg` 报 `only app manager can send message`：发消息必须用 admin token 代发（现方案已如此）。

---

## 3. 推荐方案：分两阶段

鉴于 Web SDK / WebSocket 都有验证风险，我建议**分两阶段**推进，先做稳的，再上实时。

### 阶段 A（本次 MVP）：REST 轮询兜底 —— 先让"能看到消息"

用 OpenIM REST API **轮询**拉取消息，3 秒一次，先让桌面应用能看到群里别人发的消息（有 3 秒延迟，可接受）。

关键：解决 `pull_msg_by_seq` 返回空的问题。需要先建立会话的 seq 索引。

### 阶段 B（下一阶段）：Web SDK / WebSocket 实时 —— 零延迟

集成 open-im-sdk-web 或打通自建 WebSocket，实现即时推送。

---

## 4. 阶段 A 详细设计（REST 轮询）

### 4.1 后端新增接口

```http
POST /openim/pull_messages
Content-Type: application/json

{
  "token": "{user_token}",
  "user_id": "user001",
  "conversation_id": "sg_498161590",
  "last_seq": 0          # 上次拉到的最大 seq，增量拉取
}
```

返回：
```json
{
  "ok": true,
  "messages": [
    {
      "serverMsgID": "...",
      "sendID": "user002",
      "senderNickname": "李娜",
      "content": "这次的方案我来跟进",
      "contentType": 101,
      "sendTime": 1787482370745,
      "seq": 5
    }
  ],
  "last_seq": 5
}
```

### 4.2 解决 seq 索引问题的路径

`pull_msg_by_seq` 返回空是因为会话 minSeq/maxSeq 为 0。解决思路（开发时逐一验证）：

1. **先用 OpenIM admin API 触发会话 seq 建立**（如通过 `msg/send_msg` 发一条消息到该会话）
2. **测试不同 seq 范围**（`seqBegin`/`seqEnd` 组合）
3. **如仍不行，改用 `msg/search_msg` 或 admin 视角拉取**

### 4.3 前端集成

- 选中会话后，启动该会话的轮询（3 秒）
- 收到新消息 → 追加到聊天区 → 自动滚动到底
- 若消息是自己发的，标记为右侧（self）
- 若消息来自别人且含任务 → 看板自动刷新（已有逻辑）

---

## 5. 阶段 B 详细设计（实时，预留）

### 5.1 open-im-sdk-web 接入（首选）

```bash
npm install open-im-sdk-web
```

前端初始化（示意，需按 SDK 实际 API 调整）：
```js
import OpenIMSDK from "open-im-sdk-web";
// initSDK → login(userID, token) → 注册 onRecvNewMessage 监听
```

关键点：
- 需要在 Tauri WebView 里能跑 wasm（验证 risk）
- 需要配置 SDK 连接地址指向 `ws://127.0.0.1:10001`

### 5.2 自建 WebSocket（备选）

用 Rust 侧 `tokio-tungstenite` 连接 msg_gateway，处理：
- 握手参数编码（解决 platformID int 问题）
- 心跳
- protobuf/JSON 消息解码

---

## 6. 实施步骤（阶段 A）

### Step 1：解决 seq 拉取
- 用 admin API 发一条消息到目标会话
- 验证 `pull_msg_by_seq` 能否返回消息，探索正确的 seq 范围

### Step 2：后端 `pull_messages` 接口
- 实现增量拉取，返回新消息

### Step 3：前端轮询 + 渲染
- 选中会话后启动轮询
- 渲染别人/自己的消息

### Step 4：测试
- 用 OpenIM 客户端或 admin API 模拟别人发消息
- 桌面应用 3 秒内显示

---

## 7. 验收标准（阶段 A）

| 验收项 | 标准 |
|---|---|
| 看到别人消息 | 别人在群里发消息，桌面应用 3-5 秒内显示 |
| 自己消息 | 自己发的消息显示在右侧 |
| AI 旁听 | 别人发的任务消息，看板自动更新 |
| 增量拉取 | 不重复拉取已显示消息 |

---

## 8. 风险与决策点

| 风险 | 应对 |
|---|---|
| `pull_msg_by_seq` 持续返回空 | 改用 `search_msg` 或 admin 拉取；必要时走 Web  SDK |
| Web SDK wasm 与 Tauri 不兼容 | 改用自建 WebSocket，或降级用 WebView 外置页面 |
| 轮询延迟 | 3 秒可接受；如需零延迟进阶段 B |

---

## 9. 待确认

1. 阶段 A 的 3 秒轮询延迟是否可以接受？（还是直接一步到位做阶段 B 实时）
2. OpenIM Web SDK 集成 risk 较大，是否接受先用阶段 A 跑通？

请确认后我再开发。
