import { config, warnOnce } from "./config.js";
import { sessionUser, type SessionUser } from "./auth.js";
import type { Context } from "hono";

/** 会话鉴权：Authorization: Bearer 或 x-imai-token header，无效返回 null */
export async function requireUser(c: Context): Promise<SessionUser | null> {
  const header = c.req.header("Authorization");
  const alt = c.req.header("x-imai-token");
  return sessionUser(header?.startsWith("Bearer ") ? header.slice(7).trim() : alt ?? null);
}

// ============ 认证依赖（deps.py 的 TS 版；兼容铁律：env 未设置=放行+一次性 WARN） ============

export function checkAdmin(c: Context): Record<string, unknown> | null {
  const expected = config.adminToken;
  if (!expected) {
    warnOnce("admin", "IMAI_ADMIN_TOKEN 未设置，管理端点处于无鉴权模式（内网自用默认）");
    return null;
  }
  if (c.req.header("X-IMAI-Admin-Token") === expected) return null;
  return { ok: false, error: "admin token required" };
}

export function checkCallbackToken(c: Context): Record<string, unknown> | null {
  const expected = config.authToken;
  if (!expected) {
    warnOnce("callback", "AUTH_TOKEN 未设置，回调不校验令牌（内网自用默认）");
    return null;
  }
  const header = c.req.header("X-IMAI-Token") || "";
  const qp = (c.req.query("token") || "").split("/")[0];
  if (header === expected || qp === expected) return null;
  return { ok: false, error: "callback token required" };
}

export function checkLoginPassword(body: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const expected = config.loginPassword;
  if (!expected) {
    warnOnce("login", "IMAI_LOGIN_PASSWORD 未设置，登录无口令校验（内网自用默认）");
    return null;
  }
  if ((body || {})["password"] === expected) return null;
  return { ok: false, error: "password required" };
}
