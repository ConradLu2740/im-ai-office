import { one, query, insertReturningId } from "./db.js";

// ============ 人 / 别名 ============

export interface Person { id: number; real_name: string | null; flower_name: string | null; }

export async function findPersonsByAlias(name: string): Promise<Person[]> {
  return query<Person>(
    "SELECT p.id, p.real_name, p.flower_name FROM alias a JOIN person p ON p.id=a.person_id WHERE a.name=$1", [name]);
}

export async function distinctAliasNames(): Promise<string[]> {
  const rows = await query<{ name: string }>("SELECT DISTINCT name FROM alias");
  return rows.map((r) => r.name);
}

export async function aliasLabelRows(): Promise<Array<{ name: string; real_name: string | null; flower_name: string | null }>> {
  return query("SELECT DISTINCT a.name, p.real_name, p.flower_name FROM alias a JOIN person p ON p.id=a.person_id");
}

export async function insertAliasIfAbsent(personId: number, name: string): Promise<boolean> {
  const hit = await one("SELECT 1 FROM alias WHERE person_id=$1 AND name=$2", [personId, name]);
  if (hit) return false;
  await query("INSERT INTO alias(person_id, name) VALUES($1,$2)", [personId, name]);
  return true;
}

// ============ 任务 ============

export interface TaskRow {
  id: number; content: string; creator: string | null; assignee: string | null;
  deadline: string | null; deadline_at: Date | string | null; status: string | null;
  confidence: string | null; source_msg: string | null; pending_meta: string | null;
  created_at: Date | string; updated_at: Date | string | null;
}

export async function insertTask(
  content: string, creator: string, assignee: string | null, deadline: string | null,
  status: string, confidence: string, sourceMsg: string, pendingMeta: string | null = null
): Promise<number> {
  if (pendingMeta !== null) {
    return insertReturningId(
      "INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg,pending_meta) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [content, creator, assignee, deadline, status, confidence, sourceMsg, pendingMeta]);
  }
  return insertReturningId(
    "INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [content, creator, assignee, deadline, status, confidence, sourceMsg]);
}

export async function getTaskDict(taskId: number): Promise<TaskRow | null> {
  return one<TaskRow>("SELECT * FROM task WHERE id=$1", [taskId]);
}

export async function listTaskDicts(status?: string): Promise<TaskRow[]> {
  if (status) return query<TaskRow>("SELECT * FROM task WHERE status=$1 ORDER BY id DESC", [status]);
  return query<TaskRow>("SELECT * FROM task WHERE status != 'cancelled' ORDER BY id DESC");
}

export async function latestPendingAssigneeForCreator(creator: string): Promise<TaskRow | null> {
  return one<TaskRow>("SELECT * FROM task WHERE creator=$1 AND status='pending_assignee' ORDER BY id DESC LIMIT 1", [creator]);
}

export async function latestPendingAssigneeByDmTaskid(senderId: string): Promise<TaskRow | null> {
  const dm = await one<{ task_id: number }>(
    "SELECT task_id FROM ai_dm WHERE sender_id=$1 AND task_id IS NOT NULL ORDER BY id DESC LIMIT 1", [senderId]);
  if (!dm) return null;
  return one<TaskRow>("SELECT * FROM task WHERE id=$1 AND status='pending_assignee' ORDER BY id DESC LIMIT 1", [dm.task_id]);
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
    const hit = await one<{ id: number }>(
      "SELECT id FROM message WHERE conv_id=$1 AND client_msg_id=$2 LIMIT 1", [convId, clientMsgId]);
    if (hit) return Number(hit.id);
  }
  return insertReturningId(
    "INSERT INTO message(conv_id, sender_id, sender_name, content, is_self, msg_seq, client_msg_id, content_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [convId, senderId, senderName, content, isSelf, msgSeq, clientMsgId, contentType]);
}

export async function messageList(convId?: string): Promise<MessageRow[]> {
  if (convId) return query<MessageRow>("SELECT * FROM message WHERE conv_id=$1 ORDER BY id ASC", [convId]);
  return query<MessageRow>("SELECT * FROM message ORDER BY id ASC");
}

// ============ 审计 ============

export async function auditLog(actor: string, action: string, detail: Record<string, unknown> | null = null): Promise<void> {
  await query("INSERT INTO audit(actor,action,detail) VALUES($1,$2,$3)",
    [actor, action, detail ? JSON.stringify(detail) : null]);
}

/** audit 旧 schema（created_at/JSONB）与新 schema（ts/TEXT）运行时兼容——生产库是旧 schema（交接文档 #11）。 */
export async function auditRecent(limit = 30): Promise<Array<{ actor: string; action: string; detail: unknown; ts: string }>> {
  const cols = await query<{ col: string }>(
    "SELECT column_name AS col FROM information_schema.columns WHERE table_name='audit' AND column_name IN ('ts','created_at')");
  const names = new Set(cols.map((r) => r.col));
  const tcol = names.has("ts") ? "ts" : names.has("created_at") ? "created_at" : null;
  if (!tcol) throw new Error("audit 表缺少时间列（ts/created_at）");
  const rows = await query<Record<string, unknown>>(
    `SELECT actor, action, detail, ${tcol} AS ts FROM audit ORDER BY id DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({ ...r, ts: String(r.ts) })) as Array<{ actor: string; action: string; detail: unknown; ts: string }>;
}

// ============ 术语 ============

export interface TermRow { id: number; term: string; meaning: string; source: string; created_at: Date | string; }

export async function listTermDicts(): Promise<TermRow[]> {
  return query<TermRow>("SELECT * FROM term ORDER BY id DESC");
}
