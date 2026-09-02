import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./db/drizzle.js";
import { aiDm, task } from "./db/schema.js";
import { getTaskDict, latestPendingAssigneeByDmTaskid, latestPendingAssigneeForCreator, type TaskRow } from "./repos.js";
import { confirmTask, rejectTask } from "./tasks.js";

// ============ AI 助手私聊会话（ai_dm.py 的 TS 版） ============

export async function aiDmSend(senderId: string, text: string, taskId: number | null = null, direction: "in" | "out" = "out"): Promise<number> {
  const rows = await db.insert(aiDm)
    .values({ senderId, direction, content: text, taskId })
    .returning({ id: aiDm.id });
  return rows[0].id;
}

export async function aiDmList(senderId?: string | null): Promise<Array<Record<string, unknown>>> {
  const q = db.select().from(aiDm).$dynamic().orderBy(asc(aiDm.id));
  if (senderId) return q.where(eq(aiDm.senderId, senderId));
  return q;
}

export async function aiDmUnreadCount(senderId?: string | null): Promise<number> {
  const rows = senderId
    ? await db.select({ n: sql<number>`count(*)::int` }).from(aiDm)
        .where(and(eq(aiDm.senderId, senderId), eq(aiDm.direction, "in"), eq(aiDm.readFlag, 0)))
    : await db.select({ n: sql<number>`count(*)::int` }).from(aiDm)
        .where(and(eq(aiDm.direction, "in"), eq(aiDm.readFlag, 0)));
  return Number(rows[0]?.n ?? 0);
}

export async function aiDmMarkRead(senderId?: string | null): Promise<void> {
  if (senderId) {
    await db.update(aiDm).set({ readFlag: 1 })
      .where(and(eq(aiDm.senderId, senderId), eq(aiDm.direction, "in")));
  } else {
    await db.update(aiDm).set({ readFlag: 1 }).where(eq(aiDm.direction, "in"));
  }
}

interface Candidate { person_id: number; label: string; }

function parseCandidates(t: TaskRow): Candidate[] {
  try {
    const meta = JSON.parse(t.pending_meta || "{}");
    return Array.isArray(meta.candidates) ? meta.candidates : [];
  } catch { return []; }
}

async function confirmWithAssigneeClear(taskId: number, assignee: string): Promise<void> {
  await db.update(task)
    .set({ status: "confirmed", assignee, pendingMeta: null, updatedAt: sql`NOW()` })
    .where(eq(task.id, taskId));
}

export async function resolveAssigneeReply(sender: string, reply: string): Promise<Record<string, unknown>> {
  const t = await latestPendingAssigneeForCreator(sender);
  if (!t) return { ok: false, reason: "no_pending_task" };
  const candidates = parseCandidates(t);
  const replyNorm = reply.trim();

  if (["取消", "否", "不对", "错误"].includes(replyNorm)) {
    await rejectTask(t.id, "发送者取消歧义确认");
    return { ok: true, action: "rejected", taskId: t.id };
  }
  if (/^\d+$/.test(replyNorm)) {
    const idx = parseInt(replyNorm, 10) - 1;
    if (0 <= idx && idx < candidates.length) {
      const assignee = candidates[idx].label;
      await confirmWithAssigneeClear(t.id, assignee);
      return { ok: true, action: "confirmed", taskId: t.id, assignee };
    }
    return { ok: false, reason: "invalid_choice", choices: candidates.map((c, i) => `${i + 1}. ${c.label}`) };
  }
  if (["确认", "是的", "对", "ok", "OK"].includes(replyNorm)) {
    if (t.assignee) {
      await confirmTask(t.id);
      return { ok: true, action: "confirmed", taskId: t.id };
    }
    return { ok: false, reason: "no_assignee_to_confirm" };
  }
  return { ok: false, reason: "unknown_reply" };
}

export async function resolveTaskByChoice(sender: string, choice: string, taskId?: number | null): Promise<Record<string, unknown>> {
  let t: TaskRow | null = null;
  if (taskId) {
    t = await getTaskDict(taskId);
  } else {
    t = await latestPendingAssigneeByDmTaskid(sender);
    if (!t) t = await latestPendingAssigneeForCreator(sender);
  }
  if (!t) return { ok: false, error: "no_pending_task" };
  const candidates = parseCandidates(t);
  const choiceNorm = choice.trim();
  if (/^\d+$/.test(choiceNorm)) {
    const idx = parseInt(choiceNorm, 10) - 1;
    if (0 <= idx && idx < candidates.length) {
      const assignee = candidates[idx].label;
      await confirmWithAssigneeClear(t.id, assignee);
      return { ok: true, action: "confirmed", taskId: t.id, assignee };
    }
    return { ok: false, error: "invalid_choice", candidates: candidates.map((c, i) => `${i + 1}. ${c.label}`) };
  }
  return { ok: false, error: "unknown_reply" };
}
