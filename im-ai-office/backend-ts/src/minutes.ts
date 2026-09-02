import { asc, desc, eq } from "drizzle-orm";
import { db } from "./db/drizzle.js";
import { message, minutes } from "./db/schema.js";
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

type MinutesSelect = {
  id: typeof minutes.id; conv_id: typeof minutes.convId; title: typeof minutes.title;
  summary: typeof minutes.summary; decisions: typeof minutes.decisions;
  action_items: typeof minutes.actionItems; msg_count: typeof minutes.msgCount;
  created_at: typeof minutes.createdAt;
};
const MINUTES_COLS: MinutesSelect = {
  id: minutes.id, conv_id: minutes.convId, title: minutes.title,
  summary: minutes.summary, decisions: minutes.decisions,
  action_items: minutes.actionItems, msg_count: minutes.msgCount,
  created_at: minutes.createdAt,
};

function rowToDict(r: MinutesRow): Record<string, unknown> {
  const ld = (v: unknown): unknown[] => {
    try { return v ? (typeof v === "string" ? JSON.parse(v) : v) as unknown[] : []; } catch { return []; }
  };
  return { ...r, decisions: ld(r.decisions), action_items: ld(r.action_items) };
}

export async function generateMinutes(convId: string, limit = 50): Promise<Record<string, unknown>> {
  // 子查询：取最近 N 条再按正序（与原 SQL 等价）
  const recent = db.select().from(message).where(eq(message.convId, convId))
    .orderBy(desc(message.id)).limit(Math.floor(limit)).as("t");
  const rows = await db.select().from(recent).orderBy(asc(recent.id));
  if (!rows.length) throw new Error("no_messages");
  const transcript = rows.map((r) => `【${r.ts}】${r.senderName}：${r.content}`).join("\n");
  const raw = await getLlm()(MINUTES_SYSTEM, transcript, { jsonMode: true, maxTokens: 4096 });
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw); } catch { throw new Error("bad_llm"); }
  const inserted = await db.insert(minutes)
    .values({
      convId, title: String(data.title ?? "未命名纪要"), summary: String(data.summary ?? ""),
      decisions: JSON.stringify(data.decisions ?? []), actionItems: JSON.stringify(data.action_items ?? []),
      msgCount: rows.length,
    })
    .returning({ id: minutes.id });
  const row = (await db.select(MINUTES_COLS).from(minutes).where(eq(minutes.id, inserted[0].id)).limit(1))[0] as unknown as MinutesRow;
  await auditLog("user", "minutes_generated", { minutesId: row.id, convId, msgCount: rows.length });
  return rowToDict(row);
}

export async function listMinutes(convId?: string): Promise<Array<Record<string, unknown>>> {
  const q = db.select(MINUTES_COLS).from(minutes).$dynamic().orderBy(desc(minutes.id));
  const rows = convId
    ? await q.where(eq(minutes.convId, convId)) as unknown as MinutesRow[]
    : await q as unknown as MinutesRow[];
  return rows.map(rowToDict);
}

export async function getMinutes(minutesId: number): Promise<Record<string, unknown> | null> {
  const rows = await db.select(MINUTES_COLS).from(minutes).where(eq(minutes.id, minutesId)).limit(1);
  const row = rows[0] as unknown as MinutesRow | undefined;
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
