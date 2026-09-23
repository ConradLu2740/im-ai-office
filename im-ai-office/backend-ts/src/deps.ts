import { timingSafeEqual } from "node:crypto";
import { config, warnOnce } from "./config.js";
import { sessionUser, type SessionUser } from "./auth.js";
import type { Context } from "hono";

/** 会话鉴权：Authorization: Bearer 或 x-imai-token header，无效返回 null */
export async function requireUser(c: Context): Promise<SessionUser | null> {
  const header = c.req.header("Authorization");
  const alt = c.req.header("x-imai-token");
  return sessionUser(header?.startsWith("Bearer ") ? header.slice(7).trim() : alt ?? null);
}

// ============ 认证依赖（deps.py 的 TS 版；P0 加固：env 未设置=拒绝，fail-closed） ============

/** 恒时比较（先比长度，避免 timingSafeEqual 对不等长输入抛错） */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function checkAdmin(c: Context): Record<string, unknown> | null {
  const expected = config.adminToken;
  if (!expected) {
    warnOnce("admin", "IMAI_ADMIN_TOKEN 未设置：管理端点已拒绝（fail-closed；团队部署必须显式配置）");
    return { ok: false, error: "admin token not configured" };
  }
  if (safeEqual(c.req.header("X-IMAI-Admin-Token") ?? "", expected)) return null;
  return { ok: false, error: "admin token required" };
}

export function checkCallbackToken(c: Context): Record<string, unknown> | null {
  const expected = config.authToken;
  if (!expected) {
    warnOnce("callback", "AUTH_TOKEN 未设置：回调已拒绝（fail-closed；团队部署必须显式配置）");
    return { ok: false, error: "callback token not configured" };
  }
  const header = c.req.header("X-IMAI-Token") || "";
  const qp = (c.req.query("token") || "").split("/")[0];
  if (safeEqual(header, expected) || safeEqual(qp, expected)) return null;
  return { ok: false, error: "callback token required" };
}

export function checkLoginPassword(body: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const expected = config.loginPassword;
  if (!expected) {
    warnOnce("login", "IMAI_LOGIN_PASSWORD 未设置：登录已拒绝（fail-closed；团队部署必须显式配置）");
    return { ok: false, error: "login password not configured" };
  }
  if (safeEqual(String((body || {})["password"] ?? ""), expected)) return null;
  return { ok: false, error: "password required" };
}
