import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "./db/drizzle.js";
import { alias, mineCandidate, message, person, term } from "./db/schema.js";
import { auditLog, insertTask } from "./repos.js";
import { addTerm } from "./memory.js";
import { getLlm } from "./llm.js";

// ============ B4 历史消息挖掘（mine.py 的 TS 版）：只产候选，零直接副作用 ============

const MINE_SYSTEM = (
  '你是办公群聊的知识挖掘助手。输入是一段按时间排列的群聊记录片段。' +
  '请从聊天记录里提取三类信息，输出 JSON：' +
  '{"terms":[{"term":术语,"meaning":含义}],' +
  '"aliases":[{"real_name":正名,"alias":称呼/花名/外号}],' +
  '"tasks":[{"content":待办事项,"assignee_hint":负责人(原文提及或null),' +
  '"deadline_hint":截止时间(原文提及或null)}],' +
  '"evidence":{"term":原文摘录,"alias":原文摘录,"task":原文摘录}}。' +
  '只提取聊天记录里真实出现的内容，不要编造；某类没有就给空数组。' +
  'evidence 各项给最有代表性的一句原文（没有则 null）。只输出 JSON。'
);

async function insertCandidate(convId: string, kind: string, payload: unknown, evidence: string, msgCount: number, status = "pending"): Promise<number> {
  const rows = await db.insert(mineCandidate)
    .values({ convId, kind, payload: JSON.stringify(payload), evidence, msgCount, status })
    .returning({ id: mineCandidate.id });
  return rows[0].id;
}

async function termExists(termText: string): Promise<boolean> {
  const rows = await db.select({ x: term.id }).from(term).where(eq(term.term, termText)).limit(1);
  return rows.length > 0;
}

async function aliasExists(realName: string, aliasName: string): Promise<boolean> {
  const rows = await db.select({ x: alias.id }).from(alias)
    .innerJoin(person, eq(alias.personId, person.id))
    .where(and(eq(person.realName, realName), eq(alias.name, aliasName)))
    .limit(1);
  return rows.length > 0;
}

interface MsgRow { ts: Date | string; sender_name: string; content: string; }

async function extractBatch(convId: string, rows: MsgRow[], stats: { skipped_batches: number; by_kind: Record<string, number> }): Promise<void> {
  const transcript = rows.map((r) => `【${r.ts}】${r.sender_name}：${r.content}`).join("\n");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await getLlm()(MINE_SYSTEM, transcript, { jsonMode: true, maxTokens: 4096 }));
  } catch {
    stats.skipped_batches += 1;
    return;
  }
  const ev = (data.evidence ?? {}) as Record<string, unknown>;
  for (const t of (data.terms as Array<Record<string, unknown>>) || []) {
    const termText = String(t.term ?? "").trim(), meaning = String(t.meaning ?? "").trim();
    if (!termText) continue;
    const status = (await termExists(termText)) ? "duplicate" : "pending";
    await insertCandidate(convId, "term", { term: termText, meaning }, String(ev.term ?? ""), rows.length, status);
    stats.by_kind.term += 1;
  }
  for (const a of (data.aliases as Array<Record<string, unknown>>) || []) {
    const real = String(a.real_name ?? "").trim(), aliasName = String(a.alias ?? "").trim();
    if (!real || !aliasName) continue;
    const status = (await aliasExists(real, aliasName)) ? "duplicate" : "pending";
    await insertCandidate(convId, "alias", { real_name: real, alias: aliasName }, String(ev.alias ?? ""), rows.length, status);
    stats.by_kind.alias += 1;
  }
  for (const t of (data.tasks as Array<Record<string, unknown>>) || []) {
    const content = String(t.content ?? "").trim();
    if (!content) continue;
    await insertCandidate(convId, "task",
      { content, assignee_hint: t.assignee_hint, deadline_hint: t.deadline_hint },
      String(ev.task ?? ""), rows.length);
    stats.by_kind.task += 1;
  }
}

export async function runMining(convId: string, limit = 500, batch = 100): Promise<Record<string, unknown>> {
  const recent = db.select().from(message).where(eq(message.convId, convId))
    .orderBy(desc(message.id)).limit(Math.floor(limit)).as("t");
  const rows = await db.select().from(recent).orderBy(asc(recent.id));
  if (!rows.length) throw new Error("no_messages");
  const stats = { skipped_batches: 0, by_kind: { term: 0, alias: 0, task: 0 } };
  const step = Math.max(1, Math.min(Math.floor(batch), 500));
  for (let i = 0; i < rows.length; i += step) {
    await extractBatch(convId, rows.slice(i, i + step) as unknown as MsgRow[], stats);
  }
  await auditLog("user", "mine_run", {
    convId, msgCount: rows.length, batches: Math.ceil(rows.length / step),
    skippedBatches: stats.skipped_batches, byKind: stats.by_kind,
  });
  return {
    total: stats.by_kind.term + stats.by_kind.alias + stats.by_kind.task,
    skipped_batches: stats.skipped_batches, by_kind: stats.by_kind,
  };
}

function rowToDict(row: Record<string, unknown>): Record<string, unknown> {
  let payload: unknown = {};
  try { payload = row.payload ? JSON.parse(String(row.payload)) : {}; } catch { payload = {}; }
  return { ...row, payload };
}

export async function listCandidates(status = "pending", kind?: string): Promise<Array<Record<string, unknown>>> {
  const q = db.select().from(mineCandidate).$dynamic().orderBy(desc(mineCandidate.id));
  const conds = [];
  if (status) conds.push(eq(mineCandidate.status, status));
  if (kind) conds.push(eq(mineCandidate.kind, kind));
  const rows = conds.length
    ? await q.where(and(...conds))
    : await q;
  return rows.map(rowToDict) as unknown as Array<Record<string, unknown>>;
}

async function accept(cand: Record<string, unknown>): Promise<Record<string, unknown>> {
  const kind = cand.kind as string;
  const payload = cand.payload as Record<string, unknown>;
  if (kind === "term") {
    await addTerm(String(payload.term), String(payload.meaning ?? ""), "mined");
    return { term: payload.term };
  }
  if (kind === "alias") {
    const real = String(payload.real_name), aliasName = String(payload.alias);
    const existing = await db.select({ id: person.id }).from(person)
      .where(eq(person.realName, real)).orderBy(desc(person.id)).limit(1);
    let pid: number;
    if (existing.length) {
      pid = existing[0].id;
    } else {
      const ins = await db.insert(person).values({ realName: real }).returning({ id: person.id });
      pid = ins[0].id;
    }
    const dup = await db.select({ x: alias.id }).from(alias)
      .where(and(eq(alias.personId, pid), eq(alias.name, aliasName))).limit(1);
    if (!dup.length) {
      await db.insert(alias).values({ personId: pid, name: aliasName });
    }
    return { personId: pid, alias: aliasName };
  }
  if (kind === "task") {
    const tid = await insertTask(
      String(payload.content), `mine#${cand.id}`,
      (payload.assignee_hint as string) ?? null, (payload.deadline_hint as string) ?? null,
      "pending_confirmation", "medium", String(cand.evidence ?? ""));
    return { taskId: tid };
  }
  throw new Error("bad_kind");
}

export async function decideCandidate(cid: number, action: string): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(mineCandidate).where(eq(mineCandidate.id, cid)).limit(1);
  if (!rows.length) return null;
  const cand = rowToDict(rows[0] as unknown as Record<string, unknown>);
  if (!["accept", "reject"].includes(action)) throw new Error("bad_action");
  if (cand.status !== "pending") throw new Error("already_decided");
  const result = action === "accept" ? await accept(cand) : {};
  await db.update(mineCandidate)
    .set({ status: action === "accept" ? "accepted" : "rejected", decidedAt: sql`NOW()`, decidedBy: "user" })
    .where(eq(mineCandidate.id, cid));
  await auditLog("user", action === "accept" ? "mine_accepted" : "mine_rejected",
    { candidateId: cid, kind: cand.kind, ...result });
  return { id: cid, status: action === "accept" ? "accepted" : "rejected", result };
}
