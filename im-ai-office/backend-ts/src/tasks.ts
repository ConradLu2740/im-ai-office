import { one, query } from "./db.js";
import { auditLog, getTaskDict, type TaskRow } from "./repos.js";
import { fanout } from "./sse.js";

// ============ 任务状态流转（tasks.py 的 TS 版）：confirm/reject/complete/update ============

export const CANCELLED = "cancelled";

export async function confirmTask(taskId: number, assignee?: string | null, _deadline?: string | null): Promise<boolean> {
  const t = await getTaskDict(taskId);
  if (!t) return false;
  if (assignee !== undefined && assignee !== null) {
    await query("UPDATE task SET status='confirmed', assignee=$1, updated_at=NOW() WHERE id=$2", [assignee, taskId]);
  } else {
    await query("UPDATE task SET status='confirmed', updated_at=NOW() WHERE id=$1", [taskId]);
  }
  await auditLog("user", "confirm", { taskId });
  return true;
}

export async function rejectTask(taskId: number, reason?: string | null): Promise<boolean> {
  const t = await getTaskDict(taskId);
  if (!t) return false;
  await query("UPDATE task SET status='rejected', updated_at=NOW() WHERE id=$1", [taskId]);
  await auditLog("user", "reject", { taskId, reason: reason ?? "" });
  // S4/M4：修正信号沉淀——驳回理由指明正确负责人时，更新人称别名
  if (reason) {
    const { memorizeRejectSignal } = await import("./memory.js");
    await memorizeRejectSignal(reason, taskId);
  }
  return true;
}

/** G1 完成回流：confirmed/pending → done（提醒扫描白名单不含 done，逾期提醒自然终止）。 */
export async function completeTask(taskId: number, actor = "user"): Promise<boolean> {
  const row = await one<{ status: string | null }>("SELECT status FROM task WHERE id=$1", [taskId]);
  if (!row) return false;
  if (!["confirmed", "pending_confirmation", "pending_assignee"].includes(row.status ?? "")) return false;
  await query("UPDATE task SET status='done', updated_at=NOW() WHERE id=$1", [taskId]);
  await auditLog(actor, "task_completed", { taskId });
  return true;
}

/** 迭代2 B1：已确认任务修改（改负责人/改期/取消）。返回 {task?, err?}，语义 1:1 对齐 Python。 */
export async function updateTask(
  taskId: number, assignee?: string | null, deadline?: string | null, cancel = false
): Promise<{ task?: TaskRow; err?: string }> {
  const row = await getTaskDict(taskId);
  if (!row) return { err: "task_not_found" };
  const changes: Record<string, unknown> = {};
  if (assignee !== undefined && assignee !== null && assignee !== row.assignee) {
    await query("UPDATE task SET assignee=$1, updated_at=NOW() WHERE id=$2", [assignee, taskId]);
    changes["assignee"] = [row.assignee, assignee];
  }
  if (deadline !== undefined && deadline !== null) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(deadline)) return { err: "bad_deadline" };
    await query("UPDATE task SET deadline=$1, deadline_at=$1, updated_at=NOW() WHERE id=$2", [deadline, taskId]);
    changes["deadline"] = [row.deadline, deadline];
    await query("DELETE FROM reminder_sent WHERE task_id=$1", [taskId]);
  }
  if (cancel) {
    await query("UPDATE task SET status=$1, updated_at=NOW() WHERE id=$2", [CANCELLED, taskId]);
    changes["status"] = [row.status, CANCELLED];
  }
  await auditLog("user", "task_update", { taskId, changes });
  const task = await getTaskDict(taskId);
  return { task: task! };
}
void fanout;
