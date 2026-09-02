import { config } from "./config.js";
import { query, one } from "./db.js";
import { auditLog, messageAdd } from "./repos.js";
import { fanout } from "./sse.js";
import { processMessage, auditAiProcessed } from "./pipeline.js";
import { executeAiActions } from "./actions.js";
import { resolveAssigneeReply } from "./aiDm.js";
import { openimClient } from "./openim.js";

// ============ OpenIM 回调（唯一落库 + AI 入口；网关收敛后单入口） ============

export function gatewayAutoLoginDeleted(): void { /* 已随网关收敛删除（占位防误用） */ }

export function extractTextContent(raw: unknown): string {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return String(o.content ?? o.text ?? "");
  }
  return String(raw ?? "");
}

export async function handleOpenimCallback(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(`[callback] keys=${JSON.stringify(Object.keys(payload).sort())}`);
  const grpId = String(payload.groupID ?? payload.group_id ?? "");
  const recvId = String(payload.recvID ?? payload.recv_id ?? "");
  const senderId = String(payload.sendID ?? payload.send_id ?? "");
  const senderNickname = String(payload.senderNickname ?? payload.sender_nickname ?? senderId);
  const contentType = Number(payload.contentType ?? payload.content_type ?? 101);
  const clientMsgId = String(payload.clientMsgID ?? payload.client_msg_id ?? "");
  const serverMsgId = String(payload.serverMsgID ?? payload.server_msg_id ?? "");
  const content = extractTextContent(payload.content);

  if (!content) {
    console.log(`[callback] empty_content! payload=${JSON.stringify(payload).slice(0, 400)}`);
    return { ok: true, handled: false, reason: "empty_content" };
  }
  if (Number(contentType) !== 101) return { ok: true, handled: false, reason: "not_text" };

  // 群消息：AI 旁听并识别任务（回调是唯一落库+AI 入口，网关收敛 Spec §1）
  if (grpId) {
    let contentClean = content;
    try {
      const inner = JSON.parse(content);
      if (inner && typeof inner === "object" && typeof (inner as Record<string, unknown>).content === "string") {
        contentClean = String((inner as Record<string, unknown>).content);
      }
    } catch { /* 非 JSON 包装串 */ }

    // 永久幂等闸门：同 clientMsgID 已入库 → 已被处理（防 OpenIM 重投递）
    if (clientMsgId) {
      const seen = await one(
        "SELECT 1 FROM message WHERE conv_id=$1 AND client_msg_id=$2 LIMIT 1", [`sg_${grpId}`, clientMsgId]);
      if (seen) return { ok: true, handled: true, action: "client_msg_id_seen" };
    }
    await messageAdd(`sg_${grpId}`, senderId, senderNickname, contentClean, 0, null, clientMsgId || null);

    // SSE 实时推流；server_msg_id 用于 UI 本地回声与 SSE 回声配对去重
    fanout("message", {
      conv_id: `sg_${grpId}`, send_id: senderId, sender_nickname: senderNickname,
      content: contentClean, client_msg_id: clientMsgId, server_msg_id: serverMsgId,
      send_time: Number(payload.sendTime ?? 0) || null,
    });

    const t0 = performance.now();
    const result = await processMessage(content, senderNickname, grpId);
    await auditAiProcessed(clientMsgId || null, result, contentClean, "openim_callback",
      (performance.now() - t0));
    if (result.action === "confirm_assignee") {
      const executed = await executeAiActions(result, senderId, grpId, "callback_sync");
      if (!executed.ok) return { ok: false, handled: false, action: "confirm_assignee", error: executed.error };
      return { ok: true, handled: true, action: "confirm_assignee_sent", taskId: executed.taskId };
    }
    if (result.action === "task_created") {
      return { ok: true, handled: true, action: "task_created", taskId: result.task?.taskId };
    }
    return { ok: true, handled: false, action: "skip" };
  }

  // 单聊消息：处理私聊确认回复（发给 AI 助手/系统账号）
  if (recvId && !grpId) {
    const resolved = await resolveAssigneeReply(senderNickname, content);
    if (resolved.ok && resolved.action === "confirmed") {
      try {
        const text = `【IMAI】已确认负责人：${resolved.assignee}\n任务：${resolved.taskId}`;
        await openimClient.sendPrivateConfirm("", senderId, text);
      } catch { /* ignore */ }
    }
    return { ok: true, handled: true, action: "private_reply", result: resolved };
  }

  return { ok: true, handled: false };
}

export function callbackDisabledNote(): string { void config; void query; void auditLog; return ""; }
