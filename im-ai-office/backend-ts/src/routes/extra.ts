import { Hono } from "hono";
import { generateMinutes, getMinutes, listMinutes, minutesToTask } from "../minutes.js";
import { runMining, listCandidates, decideCandidate } from "../mine.js";

export const extraRoutes = new Hono()

// ---- 会议纪要（迭代2 B2）----

  .post("/api/minutes/generate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const m = await generateMinutes(String(body.conv_id ?? ""), Number(body.limit ?? 50));
    return c.json({ ok: true, minutes: m });
  } catch (e) {
    return c.json({ ok: false, error: String(e).replace("Error: ", "") });
  }
})
  .get("/api/minutes", async (c) => {
  const convId = c.req.query("conv_id") || undefined;
  return c.json({ ok: true, minutes: await listMinutes(convId) });
})
  .get("/api/minutes/:id", async (c) => {
  const m = await getMinutes(Number(c.req.param("id")));
  return c.json({ ok: !!m, minutes: m });
})
  .post("/api/minutes/:id/task", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  try {
    const taskId = await minutesToTask(id, Number(body.index));
    if (taskId === null) return c.json({ ok: false, error: "minutes not found" }, 404);
    return c.json({ ok: true, taskId });
  } catch (e) {
    return c.json({ ok: false, error: String(e).replace("Error: ", "") }, 400);
  }
})

// ---- B4 历史挖掘 ----

  .post("/api/mine/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const r = await runMining(String(body.conv_id ?? ""), Number(body.limit ?? 500), Number(body.batch ?? 100));
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ ok: false, error: String(e).replace("Error: ", "") }, 400);
  }
})
  .get("/api/mine/candidates", async (c) => {
  const status = c.req.query("status") ?? "pending";
  const kind = c.req.query("kind") || undefined;
  return c.json({ ok: true, candidates: await listCandidates(status, kind) });
})
  .post("/api/mine/candidates/:cid/decide", async (c) => {
  const cid = Number(c.req.param("cid"));
  const body = await c.req.json().catch(() => ({}));
  try {
    const r = await decideCandidate(cid, String(body.action ?? ""));
    if (r === null) return c.json({ ok: false, error: "candidate not found" }, 404);
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ ok: false, error: String(e).replace("Error: ", "") }, 400);
  }
});
