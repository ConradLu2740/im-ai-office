import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db/drizzle.js";
import { reminderSent, task } from "./db/schema.js";
import { auditLog, getTaskDict, type TaskRow } from "./repos.js";
import { fanout } from "./sse.js";
import { UNRESOLVED_STATUS } from "./config.js";

// ============ 任务状态流转（tasks.py 的 TS 版）：confirm/reject/complete/update ============
// P1 加固：状态流转一律条件更新（WHERE status IN ...）+ 事务，杜绝
//   - 并发双 confirm/双 complete 同时成功（check-then-act 竞态）
//   - updateTask 半改状态（原：先改 assignee 再校验 deadline，失败即留半截）
// 审计写在事务外（best-effort 留痕）：状态流转的原子性是底线，审计失败不回滚状态。

export const CANCELLED = "cancelled";

const touch = { updatedAt: sql`NOW()` };

export async function confirmTask(taskId: number, assignee?: string | null, _deadline?: string | null, actor = "user"): Promise<boolean> {
  const ok = await db.transaction(async (tx) => {
    const vals: Record<string, unknown> = { status: "confirmed", ...touch };
    if (assignee !== undefined && assignee !== null) vals.assignee = assignee;
    const rows = await tx.update(task).set(vals)
      .where(and(eq(task.id, taskId), inArray(task.status, [...UNRESOLVED_STATUS])))
      .returning({ id: task.id });
    return rows.length > 0;
  });
  if (!ok) return false;
  await auditLog(actor, "confirm", { taskId });
  fanout("task_status", { taskId, status: "confirmed" });
  return true;
}

export async function rejectTask(taskId: number, reason?: string | null, actor = "user"): Promise<boolean> {
  const ok = await db.transaction(async (tx) => {
    const rows = await tx.update(task).set({ status: "rejected", ...touch })
      .where(and(eq(task.id, taskId), inArray(task.status, [...UNRESOLVED_STATUS, "confirmed"])))
      .returning({ id: task.id });
    return rows.length > 0;
  });
  if (!ok) return false;
  await auditLog(actor, "reject", { taskId, reason: reason ?? "" });
  // S4/M4：修正信号沉淀——驳回理由指明正确负责人时，更新人称别名
  if (reason) {
    const { memorizeRejectSignal } = await import("./memory.js");
    await memorizeRejectSignal(reason, taskId);
  }
  fanout("task_status", { taskId, status: "rejected" });
  return true;
}

/** G1 完成回流：confirmed/pending → done（提醒扫描白名单不含 done，逾期提醒自然终止）。 */
export async function completeTask(taskId: number, actor = "user"): Promise<boolean> {
  const rows = await db.update(task).set({ status: "done", ...touch })
    .where(and(eq(task.id, taskId), inArray(task.status, ["confirmed", ...UNRESOLVED_STATUS])))
    .returning({ id: task.id });
  if (!rows.length) return false;
  await auditLog(actor, "task_completed", { taskId });
  return true;
}

/** 迭代2 B1：已确认任务修改（改负责人/改期/取消）。返回 {task?, err?}，语义 1:1 对齐 Python。 */
export async function updateTask(
  taskId: number, assignee?: string | null, deadline?: string | null, cancel = false, actor = "user"
): Promise<{ task?: TaskRow; err?: string }> {
  const row = await getTaskDict(taskId);
  if (!row) return { err: "task_not_found" };
  // 校验先行：坏 deadline 在任何写之前返回，不再留下"assignee 已改、deadline 报错"的半改状态
  if (deadline !== undefined && deadline !== null && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(deadline)) {
    return { err: "bad_deadline" };
  }
  const changes: Record<string, unknown> = {};
  await db.transaction(async (tx) => {
    if (assignee !== undefined && assignee !== null && assignee !== row.assignee) {
      await tx.update(task).set({ assignee, ...touch }).where(eq(task.id, taskId));
      changes["assignee"] = [row.assignee, assignee];
    }
    if (deadline !== undefined && deadline !== null) {
      await tx.update(task).set({ deadline, deadlineAt: deadline, ...touch }).where(eq(task.id, taskId));
      changes["deadline"] = [row.deadline, deadline];
      await tx.delete(reminderSent).where(eq(reminderSent.taskId, taskId));
    }
    if (cancel) {
      await tx.update(task).set({ status: CANCELLED, ...touch }).where(eq(task.id, taskId));
      changes["status"] = [row.status, CANCELLED];
    }
  });
  await auditLog(actor, "task_update", { taskId, changes });
  const updated = await getTaskDict(taskId);
  fanout("task_status", { taskId, status: updated!.status ?? "" });
  return { task: updated! };
}
