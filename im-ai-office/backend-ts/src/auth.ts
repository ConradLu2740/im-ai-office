import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./db/drizzle.js";
import { appUser, session } from "./db/schema.js";

// ============ 认证（P3 自建聊天层；Spec §4.2/§4.3） ============
// scrypt 口令哈希 + 32B 随机 session token（替代 OpenIM token 体系）

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return ref.length === test.length && timingSafeEqual(test, ref);
}

export interface LoginResult {
  ok: boolean; token?: string; user_id?: string; display_name?: string | null; role?: string; error?: string;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const rows = await db.select().from(appUser).where(eq(appUser.username, username)).limit(1);
  if (!rows.length || !verifyPassword(password, rows[0].passwordHash)) {
    return { ok: false, error: "用户名或密码错误" };
  }
  const u = rows[0];
  const token = randomBytes(32).toString("hex");
  await db.insert(session).values({
    token, userId: u.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS) as unknown as string,
  });
  return { ok: true, token, user_id: u.id, display_name: u.displayName, role: u.role };
}

export interface SessionUser { id: string; role: string; displayName: string | null }

export async function sessionUser(token: string | null | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db.select({
    id: appUser.id, role: appUser.role, displayName: appUser.displayName,
  })
    .from(session)
    .innerJoin(appUser, eq(appUser.id, session.userId))
    .where(and(eq(session.token, token), gt(session.expiresAt, sql`NOW()`)))
    .limit(1);
  return rows[0] ?? null;
}

/** 从请求提取 Bearer token（或 x-imai-token 头，兼容旧调试习惯） */
export function bearerToken(headerValue: string | undefined, alt?: string): string | null {
  if (headerValue?.startsWith("Bearer ")) return headerValue.slice(7).trim() || null;
  return alt?.trim() || null;
}

/** 口令设置工具入口（scripts/set-password.mts 调用）：存在则改密，不存在则建号 */
export async function upsertPassword(username: string, password: string, userId?: string, displayName?: string): Promise<{ created: boolean; user_id: string }> {
  if (password.length < 6) throw new Error("口令至少 6 位");
  const rows = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.username, username)).limit(1);
  if (rows.length) {
    await db.update(appUser).set({ passwordHash: hashPassword(password) }).where(eq(appUser.id, rows[0].id));
    return { created: false, user_id: rows[0].id };
  }
  if (!userId) throw new Error(`用户 ${username} 不存在且未提供 user_id（应先跑 Mongo 导入）`);
  await db.insert(appUser).values({
    id: userId, username, passwordHash: hashPassword(password), displayName: displayName ?? username,
  });
  return { created: true, user_id: userId };
}
