# AI 确认卡闭环 Spec

> 目标：让 AI **识别真实群聊消息 → 自动生成确认卡（带完整 assignee/deadline）→ 发到聊天流 → 前端渲染 → 人审（确认/驳回）→ 同步看板**，形成人机协同的完整闭环。
> 日期：2026-08-22 ｜ 关联：`OpenIM联调Spec.md`、`技术设计文档.md`

---

## 0. 现状（已具备）

- ✅ 前端确认卡组件 `AiConfirmCard.vue` 已实现，`MessageItem` 检测 `ai_confirm_card` 标记渲染确认卡（可用）
- ✅ 确认/驳回按钮已接 board-api（/tasks/confirm|reject）
- ✅ ai-agent（docker）已能：消费 Redis → intent 识别 → 消歧 → 落库 task
- ✅ OpenIM send_msg 已能发消息给用户（单聊验证过）
- ⚠️ 缺口：ai-agent 落库后**不会自动发确认卡**，且确认卡 JSON 目前是我手动造的、缺 assignee/deadline

**本 spec 要补的两个点**：① ai-agent 自动发确认卡 ② 确认卡带完整真实数据。

---

## 1. 端到端链路

```
[OpenIM 群消息] --回调--> oim-webhook --Redis(msg)--> ai-agent
                                                      │
                    ┌─────────────────────────────────┘
                    ▼
               intent_detect(识别) → resolve(消歧/归属) → 落库 task(拿 taskId)
                    │
                    ▼
        生成确认卡 JSON { ai_confirm_card: {taskId, content, assignee, deadline} }
                    │
                    ▼
        OpenIM send_msg 发回(单聊/群聊) ----+----> 前端 AiConfirmCard 渲染
                    │                      │
                    ▼                      ▼
               (消息里)                [确认/驳回] → board-api → Postgres 更新
```

## 2. 确认卡 Schema（数据完整性）

```json
{
  "ai_confirm_card": {
    "taskId": 123,
    "content": "跟进这个方案",       // intent.content
    "assignee": "张伟/小张",          // resolve 结果（真实负责人，非“待指派”）
    "deadline": "周五前"              // intent.deadline_hint（真实截止）
  }
}
```

- `assignee`：来自 resolve()，self→说话人，assigned→消歧后的人，无归属→"待指派"（真实场景极少）
- `deadline`：来自 intent.deadline_hint（真实提取）
- `taskId`：落库后的真实 task.id（供确认/驳回/看板关联）

## 3. 模块改动

### 3.1 ai-agent（`services/ai-agent/main.py`）
`handle(event)` 落库后追加：
```python
# 组确认卡并发送
card = {
  "ai_confirm_card": {
    "taskId": task_id,
    "content": content,
    "assignee": assignee,
    "deadline": deadline,
  }
}
openim_client.send_confirm_card(
    recv_id=sender,          # 发送者（或群 group_id）
    text=json.dumps(card, ensure_ascii=False),
)
```

### 3.2 openim_client（`services/ai-agent/openim_client.py`）
新增 `send_confirm_card(recv_id, text, group_id=None)`：
- 群聊：`sessionType=3` + groupID
- 单聊：`sessionType=1` + recvID
- `content={content: text}`（文本）、contentType=101

### 3.3 前端
已实现（AiConfirmCard），无需改。

## 4. 发送目标（默认方案）

- **主**：群聊确认卡（若群存在）
- **兜底**：单聊发给消息发送者（消歧/低打扰）——MVP 阶段因本机建群卡住（create_group ArgsError），**用单聊演示**（发给发送者）
- 发送者可配 `OPENIM_API`/`OPENIM_ADMIN_TOKEN`（admin token 发消息）

## 5. 触发方式（消息来源）

MVP 用**注入 Redis msg 流**模拟群消息（OpenIM 群回调需建群成功，本机卡在 create_group、移交正式环境）：
```
redis-cli XADD msg '*' event message.created ... content '小张 你来跟进，周五前给我' senderId 李娜
```
→ ai-agent 消费 → 识别 → 落库 → 发确认卡给发送者

## 6. 验证标准（跑通 = 全部满足）

- [ ] 注入一条任务消息 → ai-agent 识别为任务
- [ ] 归属判定正确（"小张"→ 张伟/张敏 消歧，或 self→说话人）
- [ ] 落库 task（真实 taskId）
- [ ] **自动发出确认卡，JSON 含 taskId/content/assignee/deadline**（非"待指派"）
- [ ] 前端聊天 (AI 助手会话) 收到确认卡并渲染（带真实负责人/截止）
- [ ] 点确认/驳回 → board-api 更新 → 看板同步

## 7. 依赖与风险

| 项 | 说明 |
|---|---|
| OpenIM admin token | ai-agent 发消息需要（`OPENIM_ADMIN_TOKEN` 环境变量） |
| 建群 | 本机 create_group 卡（ArgsError，移交正式环境）→ MVP 用单聊演示 |
| assignee/deadline 提取 | 依赖 intent/resolve 准确性（核心命门，后续规模化验证） |
| 发送对象 | 需知道发送者 userID（来自消息 senderId） |

---

*AI 确认卡闭环 Spec v1 · 2026-08-22 · 待实施*
