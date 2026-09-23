import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe, unsubscribe } from "../sse.js";
import { auditRecent } from "../repos.js";
import { aiDmList, aiDmMarkRead, aiDmUnreadCount } from "../aiDm.js";
import { buildDailySummary } from "../memory.js";
import { qualityReport } from "../stats.js";
import { requireUser } from "../deps.js";
import { sessionUser, type SessionUser } from "../auth.js";
import { getRole } from "../rbac.js";

/** 私信归属收敛：非 admin 查他人 sender_id → 显式 403（M3：原静默返回自己数据，UI 像"空的"） */
async function dmScope(c: import("hono").Context, requested: string | null, user: SessionUser):
    Promise<{ senderId: string | null; denied: Response | null }> {
  if (!requested || requested === user.id) return { senderId: requested ?? user.id, denied: null };
  const isAdmin = (await getRole(user.id)) === "group_admin";
  if (!isAdmin) return { senderId: null, denied: c.json({ ok: false, error: "forbidden" }, 403) };
  return { senderId: requested, denied: null };
}

export const miscRoutes = new Hono()

// SSE 实时事件流（keepalive 防代理断链）
  .get("/api/events/stream", async (c) => {
  // EventSource 无法自定义 Authorization 头 → token 走 ?token=（仅限内网/反代部署，见部署文档）
  const header = c.req.header("Authorization");
  const user = await sessionUser(header?.startsWith("Bearer ") ? header.slice(7).trim() : c.req.query("token") ?? null);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  return streamSSE(c, async (stream) => {
    let pending: string[] = [];
    const sink = (line: string) => { pending.push(line); };
    subscribe(sink);
    try {
      await stream.writeSSE({ data: "connected", event: "hello" });
      // 1s 轮询 flush（原 15s：fanout 事件最坏延迟 15 秒，"实时"名不副实）；
      // keepalive 每 15 个 tick（≈15s）发一次，防代理断链
      let ticks = 0;
      while (true) {
        if (pending.length) {
          for (const line of pending) await stream.writeSSE({ data: line });
          pending = [];
          ticks = 0;
        }
        ticks += 1;
        if (ticks >= 15) {
          await stream.writeSSE({ data: ": keepalive" });
          ticks = 0;
        }
        await stream.sleep(1_000);
      }
    } catch { /* 客户端断开 */ }
    finally { unsubscribe(sink); }
  });
})
  .get("/api/ai_dm", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  const scope = await dmScope(c, c.req.query("sender_id") || null, user);
  if (scope.denied) return scope.denied;
  const msgs = await aiDmList(scope.senderId);
  const unread = await aiDmUnreadCount(scope.senderId);
  return c.json({ ok: true, messages: msgs, unread });
})
  .post("/api/ai_dm/read", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const scope = await dmScope(c, String(body?.sender_id ?? "") || null, user);
  if (scope.denied) return scope.denied;
  await aiDmMarkRead(scope.senderId);
  return c.json({ ok: true });
})
  .get("/api/audit", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  if ((await getRole(user.id)) !== "group_admin") return c.json({ ok: false, error: "forbidden" }, 403);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "30", 10) || 30, 1), 500);
  return c.json({ ok: true, audit: await auditRecent(limit) });
})

// M2 每日汇总兜底：被动查看不写审计（查看≠关键动作；推送侧走 daily_digest_pushed）
  .get("/api/summary/daily", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  const sm = await buildDailySummary(c.req.query("group_id") || null);
  return c.json({ ok: true, ...sm });
})

// 识别质量报告
  .get("/api/stats/quality", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  const days = parseInt(c.req.query("days") ?? "7", 10);
  if (!(1 <= days && days <= 365)) return c.json({ ok: false, error: "days 需在 1-365 之间" }, 400);
  return c.json(await qualityReport(days));
});
