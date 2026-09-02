import { Hono } from "hono";
import { bearerToken, login, sessionUser } from "../auth.js";

// ============ 认证路由（P3；替代 /openim/login） ============

export const authRoutes = new Hono()
  .post("/api/auth/login", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    if (!username || !password) return c.json({ ok: false, error: "username/password 不能为空" });
    return c.json(await login(username, password));
  })
  .post("/api/auth/logout", async (c) => {
    const token = bearerToken(c.req.header("Authorization"), c.req.header("x-imai-token"));
    if (token) {
      const { db } = await import("../db/drizzle.js");
      const { session } = await import("../db/schema.js");
      const { eq } = await import("drizzle-orm");
      await db.delete(session).where(eq(session.token, token));
    }
    return c.json({ ok: true });
  })
  .get("/api/auth/me", async (c) => {
    const u = await sessionUser(bearerToken(c.req.header("Authorization"), c.req.header("x-imai-token")));
    if (!u) return c.json({ ok: false, error: "unauthorized" }, 401);
    return c.json({ ok: true, user_id: u.id, display_name: u.displayName, role: u.role });
  });
