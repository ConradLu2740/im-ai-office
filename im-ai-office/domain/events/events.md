# 事件协议（Redis Streams）

每条消息/指令以事件入流。`id` 用 OpenIM message id 保证幂等；消费方用 consumer group + `event_dedup` 表去重。

## 流与事件

| 事件 | 流 | 载荷要点 | 消费方 |
|---|---|---|---|
| `message.created` | `msg` | msgId, grpId, senderId, content, type, at | intent |
| `ai.command` | `cmd` | grpId, query, callerId | agent |
| `task.confirmed` | `task` | taskId, finalContent, assigneeId, deadline | board |
| `task.rejected` | `task` | taskId, reason | board / memory |
| `task.completed` | `task` | taskId | board |
| `reminder.due` | `remind` | taskId, 档位 | reminder |

## 示例载荷

```json
// message.created
{
  "event": "message.created",
  "msgId": "oim_msg_123",
  "grpId": "grp_9",
  "senderId": "user_42",
  "content": "@小张 你来跟进这个方案，周五前给我",
  "type": "text",
  "at": "2026-08-22T11:30:00+08:00"
}
```

## 可靠性

- consumer group + Ack，`XAUTOCLAIM` 处理悬挂
- `event_dedup(msg_id)` 幂等去重
- 任务创建用 `(grp_id, source_msg)` 唯一约束防重复
- 所有关键动作写 `audit`
