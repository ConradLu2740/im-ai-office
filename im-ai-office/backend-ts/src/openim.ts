import { config } from "./config.js";

// ============ OpenIM 集成（openim_client.py 的 TS 版；测试可注入 stub 收集器） ============

export async function openimPost(path: string, payload: unknown, token?: string): Promise<Record<string, unknown>> {
  if (postOverride) return postOverride(path, payload, token);
  const headers: Record<string, string> = { "Content-Type": "application/json", operationID: crypto.randomUUID() };
  if (token) headers["token"] = token;
  const res = await fetch(`${config.openimApi}${path}`, {
    method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

let postOverride: ((path: string, payload: unknown, token?: string) => Promise<Record<string, unknown>>) | null = null;
export function setOpenimPost(fn: typeof postOverride): void { postOverride = fn; }

// 测试注入点：置位后所有发送只进收集器不出网（conftest.openim_sends 对应物）
let stub: { sent_group: Array<Record<string, unknown>>; sent_private: Array<Record<string, unknown>> } | null = null;

export function setOpenimStub(s: typeof stub): void { stub = s; }
export function getOpenimStub(): typeof stub { return stub; }

export const openimClient = {
  async sendGroupNotice(groupId: string, text: string): Promise<Record<string, unknown>> {
    if (stub) { stub.sent_group.push({ group_id: groupId, text }); return { errCode: 0 }; }
    return openimPost("/msg/send_msg", {
      sendID: "imai_assistant", groupID: groupId, recvID: "",
      senderNickname: "IMAI", content: { content: text }, contentType: 101, sessionType: 3,
    }, config.openimAdminToken);
  },
  async sendPrivateConfirm(_groupId: string, userId: string, text: string): Promise<Record<string, unknown>> {
    if (stub) { stub.sent_private.push({ group_id: "", user_id: userId, text }); return { errCode: 0 }; }
    return openimPost("/msg/send_msg", {
      sendID: "imai_assistant", groupID: "", recvID: userId,
      senderNickname: "IMAI 助手", content: { content: text }, contentType: 101, sessionType: 1,
    }, config.openimAdminToken);
  },
};

export async function sendMsgAsUser(payload: {
  userId: string; groupId?: string; recvId?: string; senderName: string; text: string; clientMsgId: string;
}): Promise<{ ok: boolean; serverMsgId?: string; error?: string }> {
  const data = await openimPost("/msg/send_msg", {
    sendID: payload.userId,
    groupID: payload.groupId ?? "",
    recvID: payload.recvId ?? "",
    senderNickname: payload.senderName,
    content: { content: payload.text },
    contentType: 101,
    sessionType: payload.groupId ? 3 : 1,
    clientMsgID: payload.clientMsgId,
    senderPlatformID: 4,   // 与 UI 登录 platform 一致（OSX/4）
  }, config.openimAdminToken);
  if (data.errCode !== 0) return { ok: false, error: String(data.errMsg ?? "send failed") };
  const d = data.data as Record<string, unknown> | undefined;
  return { ok: true, serverMsgId: String(d?.serverMsgID ?? "") };
}

