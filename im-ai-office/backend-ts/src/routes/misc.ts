import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe, unsubscribe } from "../sse.js";
import { auditRecent } from "../repos.js";
import { aiDmList, aiDmMarkRead, aiDmUnreadCount } from "../aiDm.js";
import { buildDailySummary } from "../memory.js";
import { qualityReport } from "../stats.js";

export const miscRoutes = new Hono()

// SSE 实时事件流（keepalive 防代理断链）
  .get("/api/events/stream", (c) => {
  return streamSSE(c, async (stream) => {
    let pending: string[] = [];
    const sink = (line: string) => { pending.push(line); };
    subscribe(sink);
    try {
      await stream.writeSSE({ data: "connected", event: "hello" });
      while (true) {
        if (pending.length) {
          for (const line of pending) await stream.writeSSE({ data: line });
          pending = [];
        }
        await stream.writeSSE({ data: ": keepalive" });
        await stream.sleep(15_000);
      }
    } catch { /* 客户端断开 */ }
    finally { unsubscribe(sink); }
  });
})
  .get("/api/ai_dm", async (c) => {
  const senderId = c.req.query("sender_id") || null;
  const msgs = await aiDmList(senderId);
  const unread = await aiDmUnreadCount(senderId);
  return c.json({ ok: true, messages: msgs, unread });
})
  .post("/api/ai_dm/read", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  await aiDmMarkRead(body?.sender_id ?? null);
  return c.json({ ok: true });
})
  .get("/api/audit", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "30", 10) || 30, 1), 500);
  return c.json({ ok: true, audit: await auditRecent(limit) });
})

// M2 每日汇总兜底：被动查看不写审计（查看≠关键动作；推送侧走 daily_digest_pushed）
  .get("/api/summary/daily", async (c) => {
  const sm = await buildDailySummary(c.req.query("group_id") || null);
  return c.json({ ok: true, ...sm });
})

// 识别质量报告
  .get("/api/stats/quality", async (c) => {
  const days = parseInt(c.req.query("days") ?? "7", 10);
  if (!(1 <= days && days <= 365)) return c.json({ ok: false, error: "days 需在 1-365 之间" }, 400);
  return c.json(await qualityReport(days));
});
