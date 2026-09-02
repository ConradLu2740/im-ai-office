import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { message, session, userGroup, userLastRead } from "../db/schema.js";
import { messageAdd } from "../repos.js";
import { auditLog } from "../repos.js";
import { fanout } from "../sse.js";
import { processMessage, auditAiProcessed } from "../pipeline.js";
import { executeAiActions } from "../actions.js";
import { sessionUser, type SessionUser } from "../auth.js";

// ============ 自建聊天层路由（P3；Spec §4.2） ============
// 发送端点内联 AI 入口（闸门平移）：落库（唯一约束幂等）→ processMessage → fanout
// SSE 事件 payload 统一携带 DB id + client_msg_id（去重键统一，评审 D3）

async function requireUser(c: import("hono").Context): Promise<SessionUser | null> {
  const header = c.req.header("Authorization");
  const alt = c.req.header("x-imai-token");
  return sessionUser(header?.startsWith("Bearer ") ? header.slice(7).trim() : alt ?? null);
}

export const messagesRoutes = new Hono()

  .post("/api/messages/send", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const convId = String(body.conv_id ?? "").trim();
    const text = String(body.text ?? "").trim();
    const clientMsgId = String(body.client_msg_id ?? "").trim();
    if (!convId || !text) return c.json({ ok: false, error: "conv_id/text 不能为空" }, 400);
    if (!clientMsgId) return c.json({ ok: false, error: "client_msg_id 不能为空（前端生成，去重键）" }, 400);
    if (!convId.startsWith("sg_")) return c.json({ ok: false, error: "仅支持群会话（sg_*）" }, 400);

    const senderId = user.id;
    const senderName = user.displayName || user.id;
    const { id, inserted } = await messageAdd(convId, senderId, senderName, text, 0, null, clientMsgId);
    if (!inserted) {
      await auditLog(senderId, "send_dedup", { convId, clientMsgId });
      return c.json({ ok: true, dedup: true, id, client_msg_id: clientMsgId });
    }

    // SSE 实时推流（DB id + client_msg_id 双去重键）
    fanout("message", {
      conv_id: convId, db_id: id, send_id: senderId, sender_nickname: senderName,
      content: text, client_msg_id: clientMsgId, send_time: null,
    });

    // 内联 AI 管线（闸门平移：原 OpenIM 回调唯一入口 → 发送端点承担）
    const grpId = convId.slice(3); // sg_ 前缀
    const t0 = performance.now();
    const result = await processMessage(text, senderName, grpId);
    await auditAiProcessed(clientMsgId, result, text, "send_endpoint", performance.now() - t0);
    let aiAction = result.action;
    if (result.action === "confirm_assignee") {
      const executed = await executeAiActions(result, senderId, grpId, "send_endpoint");
      aiAction = executed.action;
      if (!executed.ok) return c.json({ ok: false, error: executed.error }, 500);
    }

    return c.json({ ok: true, id, client_msg_id: clientMsgId, ai: { action: aiAction, task: result.task ?? null } });
  })

  // 会话列表：user_group + message 聚合（不再依赖 OpenIM REST）
  .get("/api/conversations", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
    const groups = await db.select({
      conv_id: sql<string>`'sg_' || ${userGroup.groupId}`,
      group_id: userGroup.groupId,
      name: userGroup.name,
    }).from(userGroup);
    const convs = await Promise.all(groups.map(async (g) => {
      const last = await db.select({
        id: message.id, content: message.content, sender_name: message.senderName, ts: message.ts,
      }).from(message).where(eq(message.convId, g.conv_id)).orderBy(desc(message.id)).limit(1);
      return {
        conv_id: g.conv_id, group_id: g.group_id, name: g.name,
        last_message: last[0]?.content ?? null, last_sender: last[0]?.sender_name ?? null,
        last_ts: last[0]?.ts ?? null, last_msg_id: last[0]?.id ?? null,
      };
    }));
    return c.json({ ok: true, conversations: convs });
  })

  // 未读水位：GREATEST 单语句更新（防多标签竞态，评审 D5）
  .post("/api/messages/read", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const convId = String(body.conv_id ?? "").trim();
    const lastMsgId = Number(body.last_msg_id ?? 0);
    if (!convId || !Number.isFinite(lastMsgId) || lastMsgId <= 0) {
      return c.json({ ok: false, error: "conv_id/last_msg_id 不能为空" }, 400);
    }
    await db.insert(userLastRead)
      .values({ userId: user.id, convId, lastMsgId })
      .onConflictDoUpdate({
        target: [userLastRead.userId, userLastRead.convId],
        set: { lastMsgId: sql`GREATEST(${userLastRead.lastMsgId}, ${lastMsgId})`, updatedAt: sql`NOW()` },
      });
    return c.json({ ok: true });
  })

  // 会话历史（现有 messageList 语义保留在此别名，便于前端统一走 /api/messages/*）
  .get("/api/messages/history", async (c) => {
    const convId = c.req.query("conv_id");
    const rows = await db.select().from(message)
      .where(convId ? eq(message.convId, convId) : sql`TRUE`)
      .orderBy(message.id);
    return c.json({ ok: true, messages: rows });
  })

  // 未读计数：各会话水位之后的消息数
  .get("/api/messages/unread", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
    const rows = await db.select({
      conv_id: userLastRead.convId,
      unread: sql<number>`(SELECT COUNT(*)::int FROM ${message} m WHERE m.conv_id = ${userLastRead.convId} AND m.id > COALESCE(${userLastRead.lastMsgId}, 0))`,
    }).from(userLastRead).where(eq(userLastRead.userId, user.id));
    return c.json({ ok: true, unread: rows });
  });

// session 表引用保留（会话校验走 auth.sessionUser）；防未来误删
void session;
