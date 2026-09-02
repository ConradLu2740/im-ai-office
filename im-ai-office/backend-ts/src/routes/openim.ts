import { Hono } from "hono";
import { checkAdmin, checkCallbackToken, checkLoginPassword } from "../deps.js";
import { config } from "../config.js";
import { openimPost, openimClient, sendMsgAsUser } from "../openim.js";
import { auditLog, messageAdd } from "../repos.js";
import { handleOpenimCallback } from "../callback.js";

export const openimRoutes = new Hono();

// ---- 登录 / 会话（user token 走 platformID=4，避免互踢） ----

openimRoutes.post("/openim/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const denied = checkLoginPassword(body);
  if (denied) return c.json(denied);
  const userId = String(body.user_id ?? "").trim();
  if (!userId) return c.json({ ok: false, error: "user_id 不能为空" });
  try {
    const data = await openimPost("/auth/get_user_token", {
      secret: config.openimSecret, platformID: 4, userID: userId,
    }, config.openimAdminToken);
    if (data.errCode === 0) {
      const d = data.data as Record<string, unknown>;
      return c.json({ ok: true, token: d.token, user_id: userId });
    }
    return c.json({ ok: false, error: String(data.errMsg ?? "login failed") });
  } catch (e) {
    return c.json({ ok: false, error: String(e) });
  }
});

openimRoutes.post("/openim/conversations", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token ?? ""), userId = String(body.user_id ?? "");
  if (!token || !userId) return c.json({ ok: false, error: "token/user_id 不能为空" });
  try {
    const data = await openimPost("/conversation/get_all_conversations", { ownerUserID: userId }, token);
    if (data.errCode === 0) {
      const d = data.data as Record<string, unknown>;
      return c.json({ ok: true, conversations: d.conversations ?? [] });
    }
    return c.json({ ok: false, error: String(data.errMsg ?? "get conversations failed") });
  } catch (e) {
    return c.json({ ok: false, error: String(e) });
  }
});

// ---- UI 发送入口（网关收敛 Spec）：纯 REST 代发，不落库不跑 AI ----

openimRoutes.post("/openim/send_message", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const userId = String(body.user_id ?? "");
  const groupId = String(body.group_id ?? "");
  const recvId = String(body.recv_id ?? "");
  const senderName = String(body.sender_name ?? userId);
  const text = String(body.text ?? "");
  const clientMsgId = String(body.client_msg_id ?? "").trim();
  if (!userId || !text) return c.json({ ok: false, error: "user_id/text 不能为空" });
  if (!groupId && !recvId) return c.json({ ok: false, error: "group_id 或 recv_id 不能为空" });
  if (!clientMsgId) return c.json({ ok: false, error: "client_msg_id 不能为空（前端生成，去重键）" });
  // G3 缓解：每次发送留痕（actor/IP），冒充可追溯
  const ip = c.req.header("x-forwarded-for") || "127.0.0.1";
  await auditLog(`user:${userId}`, "send_message", {
    group_id: groupId, recv_id: recvId, client_msg_id: clientMsgId, ip,
  });
  const r = await sendMsgAsUser({ userId, groupId, recvId, senderName, text, clientMsgId });
  if (!r.ok) return c.json({ ok: false, error: r.error });
  return c.json({ ok: true, msgId: r.serverMsgId, client_msg_id: clientMsgId });
});

openimRoutes.post("/openim/get_messages", (c) => c.json({ ok: true, messages: [] }));

// 群名称解析（REST 会话列表不带 showName，前端渲染需要真实群名）
openimRoutes.post("/openim/group_info", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const groupId = String(body.group_id ?? "");
  if (!groupId) return c.json({ ok: false, error: "group_id 不能为空" });
  try {
    const data = await openimPost("/group/get_groups_info", { groupIDs: [groupId] }, config.openimAdminToken);
    if (data.errCode === 0) {
      const d = data.data as { groupInfos?: Array<{ groupName?: string }> } | undefined;
      return c.json({ ok: true, groupName: d?.groupInfos?.[0]?.groupName ?? "" });
    }
    return c.json({ ok: false, error: String(data.errMsg ?? "") });
  } catch (e) {
    return c.json({ ok: false, error: String(e) });
  }
});
