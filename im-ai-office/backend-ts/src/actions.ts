import { auditLog } from "./repos.js";
import { openimClient } from "./openim.js";
import { aiDmSend } from "./aiDm.js";
import { fanout } from "./sse.js";
import { memoryProofs } from "./memory.js";
import type { ProcessResult } from "./pipeline.js";

// ============ AI 动作执行（actions.py 的 TS 版）：确认卡副作用链收敛 ============

export function buildConfirmText(task: Record<string, unknown>): string {
  const candidates = (task.candidates as Array<{ label: string }>) || [];
  const lines = ["【IMAI 任务确认】"];
  lines.push(`你刚安排的任务：${task.content}`);
  lines.push("检测到多个可能的负责人：");
  candidates.forEach((c, i) => lines.push(`${i + 1}. ${c.label}`));
  lines.push('请回复数字选择负责人，或回复"取消"跳过。');
  const proofs = (task.proofs as Array<{ term: string; meaning?: string | null }>) || [];
  if (proofs.length) {
    lines.push("");
    lines.push("（依据：" + proofs.slice(0, 3).map((p) => p.term + "=" + (p.meaning ?? "")).join("；") + "）");
  }
  return lines.join("\n");
}

export async function executeAiActions(
  result: ProcessResult, senderId: string | null, groupId = "", source = "worker"
): Promise<{ action: string; ok?: boolean; error?: string; taskId?: number; handled?: boolean }> {
  const action = result.action;
  if (action === "confirm_assignee") {
    const task = { ...(result.task ?? {}) } as Record<string, unknown>;
    task.proofs = await memoryProofs(String(task.content ?? result.message ?? ""));
    const text = buildConfirmText(task);
    await aiDmSend(senderId ?? "", text, (task.taskId as number) ?? null, "out");
    await auditLog("ai", "action_execute", { kind: "dm_out", taskId: task.taskId, source });
    try {
      await openimClient.sendPrivateConfirm(groupId, senderId ?? "", text);
    } catch (e) {
      return { action: "confirm_assignee", ok: false, error: String(e) };
    }
    fanout("ai.card", { taskId: task.taskId, assignee_candidates: task.candidates ?? [], source });
    return { action: "confirm_assignee_sent", taskId: task.taskId as number };
  }
  if (action === "task_created") {
    const task: Record<string, unknown> = { ...(result.task ?? {}) };
    await auditLog("ai", "action_execute", { kind: "none", taskId: task.taskId, source });
    fanout("task_created", { taskId: task.taskId, assignee: task.assignee, content: task.content, source });
    return { action: "task_created", taskId: task.taskId as number };
  }
  return { action: action || "skip", handled: false };
}
