# IMAI · 网关收敛 Spec（方案 B：删除 Node 网关，UI 数据面并入后端）

> 时间：2026-09-02 ｜ 背景：网关（`desktop/src/msg_gateway.bundle.cjs`，8400）是"前端不直接跑 IM SDK"决策的产物，独立 Node 运行时 + 双消息入口（SDK ws → sdk_message / webhook 回调）是 #79/#80 双建任务、重复气泡三联根因、Mac 补丁漂移、开机自启、启动顺序耦合（gateway_auto_login）等最大复杂度来源（架构分析 2026-09-02）
> 核心原则：**OpenIM webhook 回调 = 唯一落库 + AI 触发点**；UI 发送只做 REST 代发；DB + SSE 为前端唯一数据源。

---

## 1. 目标数据流（改造后）

```
发消息：UI ── POST /openim/send_message(带 client_msg_id) ──▶ OpenIM REST msg/send_msg
                                                                │ (不落库、不跑 AI)
收消息：OpenIM ── webhook 回调 ──▶ 后端：落库(message_add 幂等) + AI + fanout("message")
                                                                │
前端：EventSource /api/events/stream ◀── SSE message 事件 ────────┘
历史：GET /api/messages?conv_id=（DB 唯一渲染权威，现状已有）
会话：POST /openim/conversations（user token REST，现状已有，替代 /gw/conversations）
```

## 2. 后端改动

| # | 改动 | 细节 |
|---|---|---|
| 1 | `handle_openim_callback` 群分支 | ① 删 `senderPlatformID==5` skip（网关已不存在，REST 代发显式传 platformID=4）；② 落库后 `bus.fanout("message", {conv_id, send_id, sender_nickname, content, client_msg_id, send_time})` |
| 2 | `/openim/send_message` 语义收紧 | 必传 `client_msg_id`（前端生成）；REST payload 加 `clientMsgID`+`senderPlatformID:4`（回调原样带回 → 去重键闭环）；**删发送路径的落库+AI+confirm 副作用**（回调单入口，根治双建任务类）；返回 `{ok, serverMsgID}` |
| 3 | 删 `gateway_auto_login` | routes_openim 函数 + `__init__.py` startup 调用（无 SDK 登录可管理） |
| 4 | 删 `/gw` 反代 | `imai/api/__init__.py` 中 gw_proxy 块 |
| 5 | `/api/sdk_message` 保留 | 注释改为"测试/验收入口（acceptance 用），生产消息一律走回调" |
| 6 | 删 `desktop/src/msg_gateway.bundle.cjs` + `msg_gateway.ts` 源 | dev.ps1 同步调整 |

**行为变更登记**：UI 自发消息的 AI 确认卡不再内嵌聊天区（原 sdk_message 同步返回渲染），统一走 ai.card SSE → 看板 + AI 助手会话——与其他用户消息的既有行为一致（本来就没有内嵌卡），属行为统一而非降级。

## 3. 前端改动（web/ + desktop/src 双份同步）

| # | 改动 |
|---|---|
| 1 | 删 `initSDK`（/gw/ping 等待循环）、`startPoll`（/gw/poll 1.5s 轮询）、`loadGatewayConversations`、`renderSessions`（SDK 版） |
| 2 | SSE `onmessage`：`type=="message"` → 复用 `renderGWMessage`（字段映射 sendID/senderNickname/content/clientMsgID/conversationID/sendTime）；现有 `_seenMsgIDs` clientMsgID 去重不变 |
| 3 | SSE `onopen`（含断线重连）：节流刷新 当前会话历史 + loadConversations + updateAIUnread（丢帧/离线兜底）；状态栏「网关连接中」→「IM 连接中」→ onopen「IM 已连接」 |
| 4 | 发送：`/gw/send`+手动 `sdk_message` → 仅调 `/openim/send_message`（cmid 复用现有"回显前生成登记"逻辑） |
| 5 | 会话列表统一走 `loadConversations()`（/openim/conversations + renderConversations），renderConversations 增强：解析 latestMsg 文本预览 + unreadCount 徽标；15s 自愈改调它 |
| 6 | 历史消息 self 判断：`m.sender_id === currentUser \|\| m.is_self == 1`（修既有 own-history 显示为他人的一致性问题） |
| 7 | 两处会话下拉（纪要页等）`/gw/conversations` → `/openim/conversations` |

## 4. 去重键闭环（不变量）

`client_msg_id` 全链路唯一键：前端生成 cmid → 本地回显登记 `_seenMsgIDs` → send API 透传 OpenIM（clientMsgID）→ 回调带回 → ① DB 落库（幂等）② SSE 回声 → 前端去重拦截。历史加载重建前清空 `_seenMsgIDs`（2026-09-01 修复语义保留）。

## 5. 测试

- guard 增补：① 回调落库后产生 SSE message 事件（bus 队列断言）；② send API 透传 clientMsgID / 缺 cmid 返回 400；③ 回调同 cmid 二次投递仍被幂等闸门拦（既有用例回归）
- 全量：pytest（预期除已知 SSE 偶发外全绿）+ acceptance 12 项（走 sdk_message 不受影响）+ 浏览器实测（发消息/收到/AI 卡/看板联动）
- 统计口径：openim_send 不再产生 ai_processed（原路径同步 AI 删除），一次通过率口径不受影响（openim_send 本就非主要流量）

## 6. 明确不做

- 不动 OpenIM 服务端与 webhook 配置
- 不动 sync/async 双模式与 worker（独立议题）
- 不做 SSE 离线补偿队列（重连全量刷新历史已兜底）
