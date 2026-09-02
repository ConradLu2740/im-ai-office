import { one, query, insertReturningId } from "./db.js";
import { auditLog, insertTask } from "./repos.js";
import { getLlm } from "./llm.js";

// ============ 会议纪要（minutes.py 的 TS 版） ============

const MINUTES_SYSTEM = (
  "你是办公群聊的会议纪要助手。输入是一段按时间排列的群聊记录。" +
  '请输出 JSON：{"title": 简短会议/讨论主题, "summary": 两三句话摘要, ' +
  '"decisions": [达成的结论或决定, ...], ' +
  '"action_items": [{"content": 待办事项, "assignee_hint": 负责人(原文提及或null), ' +
  '"deadline_hint": 截止时间(原文提及或null)}]}。' +
  "只输出 JSON。没有结论则 decisions 为空数组，没有明确待办则 action_items 为空数组，" +
  "不要编造聊天记录里不存在的内容。"
);

interface MinutesRow extends Record<string, unknown> {
  id: number; conv_id: string; title: string; summary: string;
  decisions: string; action_items: string; msg_count: number; created_at: Date | string;
}

function rowToDict(r: MinutesRow): Record<string, unknown> {
  const ld = (v: unknown): unknown[] => {
    try { return v ? (typeof v === "string" ? JSON.parse(v) : v) as unknown[] : []; } catch { return []; }
  };
  return { ...r, decisions: ld(r.decisions), action_items: ld(r.action_items) };
}

export async function generateMinutes(convId: string, limit = 50): Promise<Record<string, unknown>> {
  const rows = await query<MinutesRow & { sender_name: string; content: string; ts: Date | string }>(
    "SELECT * FROM (SELECT * FROM message WHERE conv_id=$1 ORDER BY id DESC LIMIT $2) t ORDER BY id ASC",
    [convId, Math.floor(limit)]);
  if (!rows.length) throw new Error("no_messages");
  const transcript = rows.map((r) => `【${r.ts}】${r.sender_name}：${r.content}`).join("\n");
  const raw = await getLlm()(MINUTES_SYSTEM, transcript, { jsonMode: true });
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw); } catch { throw new Error("bad_llm"); }
  const id = await insertReturningId(
    "INSERT INTO minutes(conv_id, title, summary, decisions, action_items, msg_count) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    [convId, String(data.title ?? "未命名纪要"), String(data.summary ?? ""),
      JSON.stringify(data.decisions ?? []), JSON.stringify(data.action_items ?? []), rows.length]);
  const row = (await one<MinutesRow>("SELECT * FROM minutes WHERE id=$1", [id]))!;
  await auditLog("user", "minutes_generated", { minutesId: row.id, convId, msgCount: rows.length });
  return rowToDict(row);
}

export async function listMinutes(convId?: string): Promise<Array<Record<string, unknown>>> {
  const rows = convId
    ? await query<MinutesRow>("SELECT * FROM minutes WHERE conv_id=$1 ORDER BY id DESC", [convId])
    : await query<MinutesRow>("SELECT * FROM minutes ORDER BY id DESC");
  return rows.map(rowToDict);
}

export async function getMinutes(minutesId: number): Promise<Record<string, unknown> | null> {
  const row = await one<MinutesRow>("SELECT * FROM minutes WHERE id=$1", [minutesId]);
  return row ? rowToDict(row) : null;
}

export async function minutesToTask(minutesId: number, index: number): Promise<number | null> {
  const m = (await getMinutes(minutesId)) as Record<string, unknown> | null;
  if (!m) return null;
  const items = m.action_items as Array<Record<string, unknown>>;
  if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error("bad_index");
  const item = items[index];
  const tid = await insertTask(
    String(item.content ?? ""), `minutes#${minutesId}`,
    (item.assignee_hint as string) || null, (item.deadline_hint as string) || null,
    "pending_confirmation", "high", String(m.title ?? ""));
  await auditLog("user", "minutes_task_created", { minutesId, index, taskId: tid });
  return tid;
}
