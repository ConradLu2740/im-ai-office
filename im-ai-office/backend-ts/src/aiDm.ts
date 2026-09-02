import { one, query, insertReturningId } from "./db.js";
import { auditLog, getTaskDict, latestPendingAssigneeByDmTaskid, latestPendingAssigneeForCreator, type TaskRow } from "./repos.js";
import { confirmTask, rejectTask } from "./tasks.js";

// ============ AI 助手私聊会话（ai_dm.py 的 TS 版） ============

export async function aiDmSend(senderId: string, text: string, taskId: number | null = null, direction: "in" | "out" = "out"): Promise<number> {
  return insertReturningId(
    "INSERT INTO ai_dm(sender_id, direction, content, task_id) VALUES($1,$2,$3,$4) RETURNING id",
    [senderId, direction, text, taskId]);
}

export async function aiDmList(senderId?: string | null): Promise<Array<Record<string, unknown>>> {
  if (senderId) return query("SELECT * FROM ai_dm WHERE sender_id=$1 ORDER BY id ASC", [senderId]);
  return query("SELECT * FROM ai_dm ORDER BY id ASC");
}

export async function aiDmUnreadCount(senderId?: string | null): Promise<number> {
  const row = senderId
    ? await one<{ n: string }>("SELECT COUNT(*)::text AS n FROM ai_dm WHERE sender_id=$1 AND direction='in' AND read_flag=0", [senderId])
    : await one<{ n: string }>("SELECT COUNT(*)::text AS n FROM ai_dm WHERE direction='in' AND read_flag=0");
  return Number(row?.n ?? 0);
}

export async function aiDmMarkRead(senderId?: string | null): Promise<void> {
  if (senderId) await query("UPDATE ai_dm SET read_flag=1 WHERE sender_id=$1 AND direction='in'", [senderId]);
  else await query("UPDATE ai_dm SET read_flag=1 WHERE direction='in'");
}

interface Candidate { person_id: number; label: string; }

function parseCandidates(task: TaskRow): Candidate[] {
  try {
    const meta = JSON.parse(task.pending_meta || "{}");
    return Array.isArray(meta.candidates) ? meta.candidates : [];
  } catch { return []; }
}

export async function resolveAssigneeReply(sender: string, reply: string): Promise<Record<string, unknown>> {
  const task = await latestPendingAssigneeForCreator(sender);
  if (!task) return { ok: false, reason: "no_pending_task" };
  const candidates = parseCandidates(task);
  const replyNorm = reply.trim();

  if (["取消", "否", "不对", "错误"].includes(replyNorm)) {
    await rejectTask(task.id, "发送者取消歧义确认");
    return { ok: true, action: "rejected", taskId: task.id };
  }
  if (/^\d+$/.test(replyNorm)) {
    const idx = parseInt(replyNorm, 10) - 1;
    if (0 <= idx && idx < candidates.length) {
      const assignee = candidates[idx].label;
      await query(
        "UPDATE task SET status='confirmed', assignee=$1, pending_meta=NULL, updated_at=NOW() WHERE id=$2",
        [assignee, task.id]);
      return { ok: true, action: "confirmed", taskId: task.id, assignee };
    }
    return { ok: false, reason: "invalid_choice", choices: candidates.map((c, i) => `${i + 1}. ${c.label}`) };
  }
  if (["确认", "是的", "对", "ok", "OK"].includes(replyNorm)) {
    if (task.assignee) {
      await confirmTask(task.id);
      return { ok: true, action: "confirmed", taskId: task.id };
    }
    return { ok: false, reason: "no_assignee_to_confirm" };
  }
  return { ok: false, reason: "unknown_reply" };
}

export async function resolveTaskByChoice(sender: string, choice: string, taskId?: number | null): Promise<Record<string, unknown>> {
  let task: TaskRow | null = null;
  if (taskId) {
    task = await getTaskDict(taskId);
  } else {
    task = await latestPendingAssigneeByDmTaskid(sender);
    if (!task) task = await latestPendingAssigneeForCreator(sender);
  }
  if (!task) return { ok: false, error: "no_pending_task" };
  const candidates = parseCandidates(task);
  const choiceNorm = choice.trim();
  if (/^\d+$/.test(choiceNorm)) {
    const idx = parseInt(choiceNorm, 10) - 1;
    if (0 <= idx && idx < candidates.length) {
      const assignee = candidates[idx].label;
      await query(
        "UPDATE task SET status='confirmed', assignee=$1, pending_meta=NULL, updated_at=NOW() WHERE id=$2",
        [assignee, task.id]);
      return { ok: true, action: "confirmed", taskId: task.id, assignee };
    }
    return { ok: false, error: "invalid_choice", candidates: candidates.map((c, i) => `${i + 1}. ${c.label}`) };
  }
  return { ok: false, error: "unknown_reply" };
}
void auditLog; void one;
