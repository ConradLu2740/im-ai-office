import { Hono } from "hono";
import { generateMinutes, getMinutes, listMinutes, minutesToTask } from "../minutes.js";
import { runMining, listCandidates, decideCandidate } from "../mine.js";
import { requireUser } from "../deps.js";
import { getRole } from "../rbac.js";
import { errText } from "../errtext.js";

/** 登录 + admin 双重门（LLM 燃烧端点用）：返回 { user, denied }，denied 非空即返回它 */
async function adminGate(c: import("hono").Context): Promise<{ user: import("../auth.js").SessionUser | null; denied: Response | null }> {
  const user = await requireUser(c);
  if (!user) return { user: null, denied: c.json({ ok: false, error: "unauthorized" }, 401) };
  if ((await getRole(user.id)) !== "group_admin") return { user: null, denied: c.json({ ok: false, error: "forbidden" }, 403) };
  return { user, denied: null };
}

export const extraRoutes = new Hono()

// ---- 会议纪要（迭代2 B2）----

  .post("/api/minutes/generate", async (c) => {
  const g = await adminGate(c);
  if (g.denied) return g.denied;
  const body = await c.req.json().catch(() => ({}));
  try {
    const m = await generateMinutes(String(body.conv_id ?? ""), Number(body.limit ?? 50));
    return c.json({ ok: true, minutes: m });
  } catch (e) {
    return c.json({ ok: false, error: errText(e) });
  }
})
  .get("/api/minutes", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  const convId = c.req.query("conv_id") || undefined;
  return c.json({ ok: true, minutes: await listMinutes(convId) });
})
  .get("/api/minutes/:id", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: "invalid id" }, 400);
  const m = await getMinutes(id);
  return c.json({ ok: !!m, minutes: m });
})
  .post("/api/minutes/:id/task", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: "invalid id" }, 400);
  const body = await c.req.json().catch(() => ({}));
  try {
    const taskId = await minutesToTask(id, Number(body.index));
    if (taskId === null) return c.json({ ok: false, error: "minutes not found" }, 404);
    return c.json({ ok: true, taskId });
  } catch (e) {
    return c.json({ ok: false, error: errText(e) }, 400);
  }
})

// ---- B4 历史挖掘 ----

  .post("/api/mine/run", async (c) => {
  const g = await adminGate(c);
  if (g.denied) return g.denied;
  const body = await c.req.json().catch(() => ({}));
  try {
    const r = await runMining(String(body.conv_id ?? ""), Number(body.limit ?? 500), Number(body.batch ?? 100));
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ ok: false, error: errText(e) }, 400);
  }
})
  .get("/api/mine/candidates", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  const status = c.req.query("status") ?? "pending";
  const kind = c.req.query("kind") || undefined;
  return c.json({ ok: true, candidates: await listCandidates(status, kind) });
})
  .post("/api/mine/candidates/:cid/decide", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  const cid = Number(c.req.param("cid"));
  if (!Number.isInteger(cid) || cid <= 0) return c.json({ ok: false, error: "invalid cid" }, 400);
  const body = await c.req.json().catch(() => ({}));
  try {
    const r = await decideCandidate(cid, String(body.action ?? ""), user.id);
    if (r === null) return c.json({ ok: false, error: "candidate not found" }, 404);
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ ok: false, error: errText(e) }, 400);
  }
});
