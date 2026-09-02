import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { message } from "../db/schema.js";
import { auditLog, messageAdd, messageList, insertTask } from "../repos.js";
import { processMessage, auditAiProcessed } from "../pipeline.js";
import { deterministicMsgId, isDuplicate, markConsumed } from "../sse.js";
import { aiDmSend } from "../aiDm.js";
import { buildConfirmText } from "../actions.js";

export const taskRoutes = new Hono();

function extractTextContent(raw: unknown): string {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return String(o.content ?? o.text ?? "");
  }
  return String(raw ?? "");
}

// /api/chat：提交一条群消息跑完整链路（测试/调试入口）
taskRoutes.post("/api/chat", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const t0 = performance.now();
  const result = await processMessage(String(body.message ?? ""), String(body.sender ?? "李娜(娜姐)"));
  await auditAiProcessed(null, result, String(body.message ?? ""), "chat", performance.now() - t0);
  return c.json(result);
});

// /api/tasks：看板数据（默认排除 cancelled）
taskRoutes.get("/api/tasks", async (c) => {
  const status = c.req.query("status");
  const { listTaskDicts } = await import("../repos.js");
  const { memoryProofs } = await import("../memory.js");
  const rows = await listTaskDicts(status || undefined);
  const tasks = [];
  for (const t of rows) {
    const proofs = await memoryProofs(t.content ?? "");
    tasks.push({ ...t, proofs });
  }
  return c.json({ tasks });
});

// /api/simulate_message：模拟一条群消息（不依赖 OpenIM）
taskRoutes.post("/api/simulate_message", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const sender = String(body.sender ?? "李娜(娜姐)");
  const text = String(body.text ?? body.message ?? "");
  const convId = String(body.conv_id ?? "sg_001");
  if (!text) return c.json({ ok: false, error: "text 不能为空" });
  const msgId = String(body.msg_id ?? "") || deterministicMsgId(convId, sender, text);
  if (await isDuplicate(msgId)) {
    await auditLog("entry", "ai_dedup_skip", { msgId, source: "simulate" });
    return c.json({ ok: true, dedup: true, msg_id: msgId });
  }
  await messageAdd(convId, "sim_user", sender, text, 0);
  const t0 = performance.now();
  const aiResult = await processMessage(text, sender, convId);
  await auditAiProcessed(msgId, aiResult, text, "simulate", performance.now() - t0);
  await markConsumed(msgId);
  if (aiResult.action === "confirm_assignee") {
    const confirmText = buildConfirmText({ ...(aiResult.task ?? {}) });
    await aiDmSend("sim_user", confirmText, aiResult.task?.taskId ?? null, "out");
  }
  return c.json({ ok: true, ai: aiResult, message: aiResult.message ?? text });
});

// /api/sdk_message：测试/验收入口（acceptance 用）；生产消息一律走回调
taskRoutes.post("/api/sdk_message", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const sender = String(body.sender ?? "同事");
  const text = String(body.text ?? "");
  const convId = String(body.conv_id ?? "sg_sdk");
  const sendId = String(body.send_id ?? "");
  if (!text) return c.json({ ok: false, error: "text 不能为空" });
  const msgId = String(body.msg_id ?? "") || deterministicMsgId(convId, sender, text);
  const clientMsgId = String(body.client_msg_id ?? "").trim();
  if (clientMsgId) {
    const seen = await db.select({ x: message.id }).from(message)
      .where(and(eq(message.convId, convId), eq(message.clientMsgId, clientMsgId))).limit(1);
    if (seen.length) return c.json({ ok: true, dedup: true, msg_id: msgId, reason: "client_msg_id_seen" });
  }
  if (await isDuplicate(msgId)) {
    await auditLog("entry", "ai_dedup_skip", { msgId, source: "sdk" });
    return c.json({ ok: true, dedup: true, msg_id: msgId });
  }
  await messageAdd(convId, sendId || "sdk_user", sender, text, 0, null, clientMsgId || null);
  const t0 = performance.now();
  const aiResult = await processMessage(text, sender, convId);
  await auditAiProcessed(msgId, aiResult, text, "sdk_message", performance.now() - t0);
  await markConsumed(msgId);
  if (aiResult.action === "confirm_assignee") {
    const confirmText = buildConfirmText({ ...(aiResult.task ?? {}) });
    await aiDmSend(sendId || "sdk_user", confirmText, aiResult.task?.taskId ?? null, "out");
  }
  return c.json({ ok: true, ai: aiResult, message: aiResult.message ?? text });
});

// /api/messages：会话历史（DB 唯一渲染权威）
taskRoutes.get("/api/messages", async (c) => {
  const convId = c.req.query("conv_id");
  const rows = await messageList(convId || undefined);
  return c.json({ messages: rows });
});

taskRoutes.post("/api/tasks/:task_id/confirm", async (c) => {
  const taskId = Number(c.req.param("task_id"));
  const body = await c.req.json().catch(() => ({}));
  const { confirmTask } = await import("../tasks.js");
  const ok = await confirmTask(taskId, body.assignee ?? null, body.deadline ?? null);
  return c.json({ ok });
});

taskRoutes.post("/api/tasks/:task_id/reject", async (c) => {
  const taskId = Number(c.req.param("task_id"));
  const body = await c.req.json().catch(() => ({}));
  const { rejectTask } = await import("../tasks.js");
  const ok = await rejectTask(taskId, body.reason ?? null);
  return c.json({ ok });
});

// G1 完成回流：任务标记 done，逾期提醒自然终止
taskRoutes.post("/api/tasks/:task_id/complete", async (c) => {
  const taskId = Number(c.req.param("task_id"));
  const body = await c.req.json().catch(() => ({}));
  const { completeTask } = await import("../tasks.js");
  const { fanout } = await import("../sse.js");
  const ok = await completeTask(taskId, body.actor || "user");
  if (ok) fanout("task_completed", { taskId });
  return c.json({ ok });
});

taskRoutes.post("/api/tasks/resolve", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { resolveTaskByChoice } = await import("../aiDm.js");
  const r = await resolveTaskByChoice(String(body.sender_id ?? ""), String(body.choice ?? ""), body.task_id);
  return c.json(r);
});

// 迭代2 B1：已确认任务修改（改负责人/改期/取消）
taskRoutes.patch("/api/tasks/:task_id", async (c) => {
  const taskId = Number(c.req.param("task_id"));
  const body = await c.req.json().catch(() => ({}));
  if (body.action && body.action !== "cancel") {
    return c.json({ ok: false, error: "action 仅支持 cancel" }, 400);
  }
  const { updateTask } = await import("../tasks.js");
  const { task, err } = await updateTask(taskId, body.assignee ?? null, body.deadline ?? null, body.action === "cancel");
  if (err) return c.json({ ok: false, error: err }, 400);
  return c.json({ ok: true, task });
});
void insertTask;
