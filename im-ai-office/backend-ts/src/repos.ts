import { and, desc, eq, ne, isNotNull, sql } from "drizzle-orm";
import { db } from "./db/drizzle.js";
import { aiDm, alias, audit, message, person, task, term } from "./db/schema.js";

// 数据访问层（Drizzle 查询构建器；行为与手写 SQL 版逐字等价，返回键保持 snake_case）

// ============ 人 / 别名 ============

export interface Person { id: number; real_name: string | null; flower_name: string | null; }

export async function findPersonsByAlias(name: string): Promise<Person[]> {
  return db.select({
    id: person.id,
    real_name: person.realName,
    flower_name: person.flowerName,
  })
    .from(alias)
    .innerJoin(person, eq(person.id, alias.personId))
    .where(eq(alias.name, name));
}

export async function distinctAliasNames(): Promise<string[]> {
  const rows = await db.selectDistinct({ name: alias.name }).from(alias);
  return rows.map((r) => r.name!);
}

export async function aliasLabelRows(): Promise<Array<{ name: string; real_name: string | null; flower_name: string | null }>> {
  return db.selectDistinct({
    name: alias.name,
    real_name: person.realName,
    flower_name: person.flowerName,
  })
    .from(alias)
    .innerJoin(person, eq(person.id, alias.personId)) as Promise<Array<{ name: string; real_name: string | null; flower_name: string | null }>>;
}

export async function insertAliasIfAbsent(personId: number, name: string): Promise<boolean> {
  const inserted = await db.insert(alias)
    .values({ personId, name })
    .onConflictDoNothing()
    .returning({ id: alias.id });
  return inserted.length > 0;
}

// ============ 任务 ============

export interface TaskRow {
  id: number; content: string; creator: string | null; assignee: string | null;
  deadline: string | null; deadline_at: Date | string | null; status: string | null;
  confidence: string | null; source_msg: string | null; pending_meta: string | null;
  created_at: Date | string; updated_at: Date | string | null;
}

type TaskSelect = {
  id: typeof task.id; content: typeof task.content; creator: typeof task.creator;
  assignee: typeof task.assignee; deadline: typeof task.deadline; deadline_at: typeof task.deadlineAt;
  status: typeof task.status; confidence: typeof task.confidence; source_msg: typeof task.sourceMsg;
  pending_meta: typeof task.pendingMeta; created_at: typeof task.createdAt; updated_at: typeof task.updatedAt;
};
const TASK_COLS: TaskSelect = {
  id: task.id, content: task.content, creator: task.creator,
  assignee: task.assignee, deadline: task.deadline, deadline_at: task.deadlineAt,
  status: task.status, confidence: task.confidence, source_msg: task.sourceMsg,
  pending_meta: task.pendingMeta, created_at: task.createdAt, updated_at: task.updatedAt,
};

export async function insertTask(
  content: string, creator: string, assignee: string | null, deadline: string | null,
  status: string, confidence: string, sourceMsg: string, pendingMeta: string | null = null
): Promise<number> {
  const rows = await db.insert(task)
    .values(pendingMeta !== null
      ? { content, creator, assignee, deadline, status, confidence, sourceMsg, pendingMeta }
      : { content, creator, assignee, deadline, status, confidence, sourceMsg })
    .returning({ id: task.id });
  return rows[0].id;
}

export async function getTaskDict(taskId: number): Promise<TaskRow | null> {
  const rows = await db.select(TASK_COLS).from(task).where(eq(task.id, taskId)).limit(1);
  return (rows[0] as unknown as TaskRow) ?? null;
}

export async function listTaskDicts(status?: string): Promise<TaskRow[]> {
  if (status) {
    return db.select(TASK_COLS).from(task).where(eq(task.status, status)).orderBy(desc(task.id)) as unknown as Promise<TaskRow[]>;
  }
  return db.select(TASK_COLS).from(task).where(ne(task.status, "cancelled")).orderBy(desc(task.id)) as unknown as Promise<TaskRow[]>;
}

export async function latestPendingAssigneeForCreator(creator: string): Promise<TaskRow | null> {
  const rows = await db.select(TASK_COLS).from(task)
    .where(and(eq(task.creator, creator), eq(task.status, "pending_assignee")))
    .orderBy(desc(task.id)).limit(1);
  return (rows[0] as unknown as TaskRow) ?? null;
}

export async function latestPendingAssigneeByDmTaskid(senderId: string): Promise<TaskRow | null> {
  const dm = await db.select({ task_id: aiDm.taskId }).from(aiDm)
    .where(and(eq(aiDm.senderId, senderId), isNotNull(aiDm.taskId)))
    .orderBy(desc(aiDm.id)).limit(1);
  if (!dm.length || dm[0].task_id == null) return null;
  const rows = await db.select(TASK_COLS).from(task)
    .where(and(eq(task.id, dm[0].task_id), eq(task.status, "pending_assignee")))
    .orderBy(desc(task.id)).limit(1);
  return (rows[0] as unknown as TaskRow) ?? null;
}

// ============ 消息表 ============

export interface MessageRow {
  id: number; conv_id: string; sender_id: string; sender_name: string; content: string;
  content_type: number; is_self: number; msg_seq: number | null; client_msg_id: string | null; ts: Date | string;
}

/** 幂等：同 conv 内相同 client_msg_id 已存在时直接返回既有 id。 */
export async function messageAdd(
  convId: string, senderId: string, senderName: string, content: string,
  isSelf = 0, msgSeq: number | null = null, clientMsgId: string | null = null, contentType = 101
): Promise<number> {
  if (clientMsgId) {
    const hit = await db.select({ id: message.id }).from(message)
      .where(and(eq(message.convId, convId), eq(message.clientMsgId, clientMsgId)))
      .limit(1);
    if (hit.length) return Number(hit[0].id);
  }
  const rows = await db.insert(message)
    .values({ convId, senderId, senderName, content, isSelf, msgSeq, clientMsgId, contentType })
    .returning({ id: message.id });
  return rows[0].id;
}

export async function messageList(convId?: string): Promise<MessageRow[]> {
  const q = db.select({
    id: message.id, conv_id: message.convId, sender_id: message.senderId,
    sender_name: message.senderName, content: message.content, content_type: message.contentType,
    is_self: message.isSelf, msg_seq: message.msgSeq, client_msg_id: message.clientMsgId, ts: message.ts,
  }).from(message).$dynamic();
  if (convId) return q.where(eq(message.convId, convId)).orderBy(message.id) as unknown as Promise<MessageRow[]>;
  return q.orderBy(message.id) as unknown as Promise<MessageRow[]>;
}

// ============ 审计 ============

export async function auditLog(actor: string, action: string, detail: Record<string, unknown> | null = null): Promise<void> {
  await db.insert(audit).values({ actor, action, detail: detail ? JSON.stringify(detail) : null });
}

/** 生产 audit 已对齐代码 schema（ts + TEXT detail，drizzle 0000 迁移），探测分支退役。 */
export async function auditRecent(limit = 30): Promise<Array<{ actor: string; action: string; detail: unknown; ts: string }>> {
  const rows = await db.select({
    actor: audit.actor, action: audit.action, detail: audit.detail, ts: audit.ts,
  }).from(audit).orderBy(desc(audit.id)).limit(limit) as unknown as Array<{ actor: string; action: string; detail: unknown; ts: string }>;
  return rows.map((r) => {
    let detail: unknown = r.detail;
    if (typeof detail === "string") {
      try { detail = JSON.parse(detail); } catch { /* 保持原字符串 */ }
    }
    return { actor: r.actor, action: r.action, detail, ts: String(r.ts) };
  });
}

// ============ 术语 ============

export interface TermRow { id: number; term: string; meaning: string; source: string; created_at: Date | string; }

export async function listTermDicts(): Promise<TermRow[]> {
  const rows = await db.select({
    id: term.id, term: term.term, meaning: term.meaning, source: term.source, created_at: term.createdAt,
  }).from(term).orderBy(desc(term.id)) as unknown as Promise<TermRow[]>;
  return rows;
}

// 保留 sql 模板逃生舱引用（复杂聚合在 stats.ts 使用）
export const _sql = sql;
