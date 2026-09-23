import { sessionUser, type SessionUser } from "./auth.js";
import type { Context } from "hono";

/** 会话鉴权：Authorization: Bearer 或 x-imai-token header，无效返回 null */
export async function requireUser(c: Context): Promise<SessionUser | null> {
  const header = c.req.header("Authorization");
  const alt = c.req.header("x-imai-token");
  return sessionUser(header?.startsWith("Bearer ") ? header.slice(7).trim() : alt ?? null);
}

/**
 * 管理端点门（P0 终审修复）：登录 + group_admin 角色。
 * 原 checkAdmin（X-IMAI-Admin-Token 头 + env fail-closed）有两个问题：
 * 前端只会带 Bearer，RBAC 面板必然 401；且 token 与角色两套体系分裂。
 * 收敛为与 /api/audit、term delete 一致的模式：session + role。
 */
export async function requireAdmin(c: Context): Promise<{ user: SessionUser | null; denied: Response | null }> {
  const user = await requireUser(c);
  if (!user) return { user: null, denied: c.json({ ok: false, error: "unauthorized" }, 401) };
  const { getRole } = await import("./rbac.js");
  if ((await getRole(user.id)) !== "group_admin") return { user: null, denied: c.json({ ok: false, error: "forbidden" }, 403) };
  return { user, denied: null };
}
