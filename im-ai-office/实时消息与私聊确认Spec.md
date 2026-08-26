# 实时收消息 + AI 私聊确认会话化 Spec

> 目标：让 IMAI 办公助手能**收消息**（看到群里别人发的消息），并把**私聊确认**做成真正的会话交互。
> 前提：登录、会话列表、发消息、AI 识别、看板已跑通。

---

## 1. 技术探测结论（已实测）

### 1.1 已确认可用

| 能力 | 接口 | 说明 |
|---|---|---|
| 登录 | `POST /auth/get_user_token` | 需 admin token + platformID(5) + secret |
| 注册用户 | `POST /user/user_register` | 需 admin token，`users` 数组 |
| 建群 | `POST /group/create_group` | `ownerUserID` + `groupInfo{groupType:2}` + `memberUserIDs` |
| 会话列表 | `POST /conversation/get_all_conversations` | 需用户 token |
| 发消息 | `POST /msg/send_msg` | 需 **admin token** 代发，sender 显示为 `sendID` |

### 1.2 探测受阻的能力

| 能力 | 问题 |
|---|---|
| WebSocket 实时收消息 | OpenIM 3.8 msggateway 握手要求 `platformID` 为 int，但 query string 天然是字符串，`strconv.Atoi` 解析失败。需要 SDK 级兼容才能连通。 |
| REST 拉历史消息 | `/msg/pull_msg_by_seq` 返回空 `data:{}`，因为会话 seq 索引需要客户端先通过 WS 同步才能建立。 |

### 1.3 结论

- 完整实时（收别人消息 + 已读 + seq 同步）需要集成 **OpenIM Web SDK（open-im-sdk-web）**，这是后续增强项。
- MVP 采用 **简化方案**：以「自己发消息」为入口，后端同步做 AI 识别，前端即时渲染；别人消息靠 Web SDK 增强后补齐。

---

## 2. MVP 方案

### 2.1 收消息（简化）

当前已实现的简化闭环：

```
用户在桌面应用发消息
    → 后端 admin API 代发到 OpenIM
    → 后端立即调用 core.process_message() 做 AI 识别
    → 前端显示 AI 识别卡（任务/歧义）
    → 看板更新
```

这个闭环保证：**你发的每条消息，AI 都会识别，结果即时可见**。这已经满足「在桌面应用里发任务消息 → 出任务」。

### 2.2 AI 私聊确认会话化

把「弹窗提示 + 输入框回复数字」升级为**真正的会话交互**：

1. AI 助手作为一个独立会话（`userID=imai_assistant`，昵称"AI助手"）加入会话列表
2. 发送者发消息触发歧义时：
   - AI 助手私聊发送者，发确认消息（含 1.张伟 2.张敏 选项）
   - AI 助手会话在桌面应用会话列表置顶，显示未读
3. 发送者点开 AI 助手会话，回复数字 `1`/`2`
4. 后端识别回复，更新任务状态

---

## 3. 技术实现

### 3.1 AI 助手会话实现

- 创建系统用户 `imai_assistant`（已注册）
- 前端会话列表额外显示「AI 助手」固定置顶项（不依赖 OpenIM 会话列表）
- 点击 AI 助手会话 → 显示历史确认消息（存本地 SQLite `ai_dm_table`）
- 在 AI 助手会话里回复数字 → 调 `/api/tasks/resolve` 接口

### 3.2 私聊确认数据流

```
群消息有歧义
  → core.process_message() 返回 confirm_assignee
  → 后端调 admin API send_msg(imai_assistant → sender, 确认文本)
  → 同时写入本地 ai_dm_table(sender, taskId, candidates, pending)
  → 前端轮询 ai_dm_table，AI 助手会话出现新消息 + 未读
  → 用户点开 AI 助手会话，回复数字
  → 调 /api/tasks/resolve(taskId, choice)
  → 任务更新为 confirmed，AI 助手会话追加"已确认"消息
```

### 3.3 新增后端接口

```http
POST /api/ai_dm/send   # AI 助手发确认消息（写入本地表 + 调 OpenIM send_msg）
GET  /api/ai_dm/list   # 某用户与 AI 助手的会话历史
POST /api/tasks/resolve # 处理用户回复数字，更新任务
```

### 3.4 新增本地表

```sql
CREATE TABLE ai_dm (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT,           -- 与谁对话（发送者 userID）
  direction TEXT,           -- out=AI发出 in=用户回复
  content TEXT,
  task_id INTEGER,
  ts TEXT DEFAULT (datetime('now')),
  read_flag INTEGER DEFAULT 0
);
```

---

## 4. 实施步骤

### Step 1：后端 AI 助手消息表 + 接口
- 建 `ai_dm` 表
- 实现 `/api/ai_dm/list`、`/api/tasks/resolve`
- 歧义时写入 `ai_dm` + 调 OpenIM 私聊发送

### Step 2：前端 AI 助手会话
- 会话列表固定加「AI 助手」项
- 点击显示确认历史
- 回复数字 → 调 `/api/tasks/resolve` → 刷新看板

### Step 3：OpenIM 私聊确认
- 歧义时调 `send_msg(imai_assistant → senderID)` 把确认消息发到 OpenIM
- 让发送者既能在桌面应用看到 AI 助手消息，也能在 OpenIM 端收到

### Step 4：端到端测试
- 发歧义消息 → AI 助手会话出现确认 → 回复数字 → 看板更新

---

## 5. 收消息增强（后续，非 MVP）

集成 OpenIM Web SDK，实现真正实时：
- 前端初始化 `open-im-sdk-web`
- 连接 OpenIM 服务端，注册消息监听
- 实时收到群消息并渲染
- 同步 seq，拉取历史消息

> 该部分需要 SDK 兼容性验证，列为独立迭代。

---

## 6. 验收标准（MVP）

| 验收项 | 标准 |
|---|---|
| 发消息 AI 识别 | 桌面应用发任务消息，AI 卡立即显示，看板出任务 |
| AI 助手会话 | 歧义时会话列表出现「AI 助手」，含确认消息 |
| 回复确认 | 在 AI 助手会话回复数字，看板任务变已确认 |
| 私聊到 OpenIM | 发送者在 OpenIM 端也能收到 AI 助手确认消息 |
