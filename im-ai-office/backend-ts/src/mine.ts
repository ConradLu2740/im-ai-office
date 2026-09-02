import { one, query, insertReturningId } from "./db.js";
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
  return insertReturningId(
    "INSERT INTO mine_candidate(conv_id, kind, payload, evidence, msg_count, status) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    [convId, kind, JSON.stringify(payload), evidence, msgCount, status]);
}

async function termExists(term: string): Promise<boolean> {
  return (await one("SELECT 1 FROM term WHERE term=$1", [term])) !== null;
}

async function aliasExists(realName: string, alias: string): Promise<boolean> {
  return (await one(
    "SELECT 1 FROM alias a JOIN person p ON a.person_id=p.id WHERE p.real_name=$1 AND a.name=$2",
    [realName, alias])) !== null;
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
    const term = String(t.term ?? "").trim(), meaning = String(t.meaning ?? "").trim();
    if (!term) continue;
    const status = (await termExists(term)) ? "duplicate" : "pending";
    await insertCandidate(convId, "term", { term, meaning }, String(ev.term ?? ""), rows.length, status);
    stats.by_kind.term += 1;
  }
  for (const a of (data.aliases as Array<Record<string, unknown>>) || []) {
    const real = String(a.real_name ?? "").trim(), alias = String(a.alias ?? "").trim();
    if (!real || !alias) continue;
    const status = (await aliasExists(real, alias)) ? "duplicate" : "pending";
    await insertCandidate(convId, "alias", { real_name: real, alias }, String(ev.alias ?? ""), rows.length, status);
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
  const rows = await query<MsgRow>(
    "SELECT * FROM (SELECT * FROM message WHERE conv_id=$1 ORDER BY id DESC LIMIT $2) t ORDER BY id ASC",
    [convId, Math.floor(limit)]);
  if (!rows.length) throw new Error("no_messages");
  const stats = { skipped_batches: 0, by_kind: { term: 0, alias: 0, task: 0 } };
  const step = Math.max(1, Math.min(Math.floor(batch), 500));
  for (let i = 0; i < rows.length; i += step) {
    await extractBatch(convId, rows.slice(i, i + step), stats);
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
  const conds: string[] = []; const params: unknown[] = [];
  if (status) { conds.push(`status=$${params.length + 1}`); params.push(status); }
  if (kind) { conds.push(`kind=$${params.length + 1}`); params.push(kind); }
  const where = conds.length ? " WHERE " + conds.join(" AND ") : "";
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM mine_candidate${where} ORDER BY id DESC`, params);
  return rows.map(rowToDict);
}

async function accept(cand: Record<string, unknown>): Promise<Record<string, unknown>> {
  const kind = cand.kind as string;
  const payload = cand.payload as Record<string, unknown>;
  if (kind === "term") {
    await addTerm(String(payload.term), String(payload.meaning ?? ""), "mined");
    return { term: payload.term };
  }
  if (kind === "alias") {
    const real = String(payload.real_name), alias = String(payload.alias);
    const p = await one<{ id: number }>("SELECT id FROM person WHERE real_name=$1 ORDER BY id DESC LIMIT 1", [real]);
    let pid: number;
    if (p) pid = p.id;
    else pid = await insertReturningId("INSERT INTO person(real_name) VALUES($1) RETURNING id", [real]);
    if (!(await one("SELECT 1 FROM alias WHERE person_id=$1 AND name=$2", [pid, alias]))) {
      await query("INSERT INTO alias(person_id, name) VALUES($1,$2)", [pid, alias]);
    }
    return { personId: pid, alias };
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
  const row = await one<Record<string, unknown>>("SELECT * FROM mine_candidate WHERE id=$1", [cid]);
  if (!row) return null;
  const cand = rowToDict(row);
  if (!["accept", "reject"].includes(action)) throw new Error("bad_action");
  if (cand.status !== "pending") throw new Error("already_decided");
  const result = action === "accept" ? await accept(cand) : {};
  await query(
    "UPDATE mine_candidate SET status=$1, decided_at=NOW(), decided_by='user' WHERE id=$2",
    [action === "accept" ? "accepted" : "rejected", cid]);
  await auditLog("user", action === "accept" ? "mine_accepted" : "mine_rejected",
    { candidateId: cid, kind: cand.kind, ...result });
  return { id: cid, status: action === "accept" ? "accepted" : "rejected", result };
}
