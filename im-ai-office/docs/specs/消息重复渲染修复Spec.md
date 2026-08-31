# 消息重复渲染修复 Spec

> 日期：2026-08-31 · 类型：缺陷修复 · 影响：浏览器模式聊天区

## 现象

UI 发送一条群消息后，聊天区同一气泡每 1.5s（轮询周期）追加一份，20 分钟内累计 356 个气泡、
"收 N 条"计数涨至 109；且该消息气泡串进「AI 助手」会话。数据库 `message` 仅 1 行——纯渲染层问题。

## 根因（三个缺陷叠加）

1. **后端 `/gw` 反代丢弃 query string**（`imai/api/__init__.py`）：
   `GET /gw/poll?since=1` 转发到网关变成 `GET /gw/poll`，`since` 默认 0 →
   网关每次返回**全量** msgBuffer。前端游标 `lastMsgSeq` 永远在推进但永远无效。
2. **网关缓冲条目缺 `clientMsgID`**（`msg_gateway.bundle.cjs`）：
   `OnRecvNewMessages` 与 `/gw/send` 两条写入路径的 item 均无 clientMsgID →
   前端 `_seenMsgIDs` 去重从不命中，全量回放全部变成可见重复气泡。
3. **UI 发送未传递统一去重键**（`app.js` sendMsg）：
   UI 直接 `POST /api/sdk_message` 不带 `client_msg_id`（落库 NULL），与 `/gw/send`
   缓冲条目（SDK 生成 ID）无关联 → 「轮询渲染」与「历史加载」两条路径无法互相去重。
   实证触发：会话重选时历史加载（NULL 键）+ 缓冲回放（SDK 键）各渲染一份。

另：`renderGWMessage` 不按会话过滤 → 群消息可串进 AI 助手会话（缺陷 3 的伴生表现）。

## 修复

| 文件 | 变更 |
|---|---|
| `imai/api/__init__.py` | `/gw` 反代透传 query string（`?` + request.url.query） |
| `desktop/src/msg_gateway.bundle.cjs` | ① 两条缓冲写入路径补 `clientMsgID`；② `/gw/send` 优先采用 UI 传入的 `client_msg_id` |
| `web/app.js` + `desktop/src/app.js`（同步） | ① sendMsg 生成 `crypto.randomUUID()` 并同时传给 `/gw/send` 与 `/api/sdk_message`；② renderGWMessage 无 clientMsgID 时按 `sendID\|content\|sendTime` 兜底去重；③ 按会话过滤（`m.conversationID` 与当前会话不一致不渲染） |
| `web/index.html` + `desktop/src/index.html` | `app.js` 引用加 `?v=20260831`（静态资源缓存击穿，实测普通 reload 无法刷新旧脚本） |

## 验证

- 端到端：发送「小钱 周五前完成竞品报告初稿」→ 气泡恰 1 份；观察 30s（20 个轮询周期）不增长；
  切走再切回会话仍 1 份；AI 助手会话 0 份串场；AI 识别正常建任务（#40 小钱/周五前/high）。
- 落库：`message.client_msg_id` 为 UI 生成的 UUID，与缓冲条目同键。
- 回归：`python -m pytest tests/ -q` → 105 passed / 22 skipped（guard_pg 需 imai_test 库，跳过属预期）。
- 直连验证：`/gw/poll?since=1` 经反代返回 `msgs: 0`（修复前返回全量）。

## 遗留注意

- 网关重启后需触发 SDK 登录（后端 startup 的 `gateway_auto_login` 是一次性线程；
  手动重启网关后可重启后端或重跑该函数），否则 `/gw/ping` connected=false。
- `msg_gateway.ts`（Mac 源）与本 bundle 的差异项已在交接文档 #3 记录，下次 Mac 同步时一并带上本次改动。
