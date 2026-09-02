import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { term as termT } from "../db/schema.js";
import { auditLog } from "../repos.js";
import { addTerm, getGrpMeta, listTerms, memorizeCorrective, setGrpMeta } from "../memory.js";

export const memoryRoutes = new Hono();

memoryRoutes.get("/api/terms", async (c) => {
  return c.json({ ok: true, terms: await listTerms() });
});

memoryRoutes.post("/api/term/add", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  await addTerm(String(body.term ?? ""), String(body.meaning ?? ""), "manual");
  return c.json({ ok: true, term: body.term, meaning: body.meaning });
});

memoryRoutes.patch("/api/term/:term", async (c) => {
  const term = c.req.param("term");
  const body = await c.req.json().catch(() => ({}));
  if (!String(body.meaning ?? "").trim()) return c.json({ ok: false, error: "meaning 不能为空" }, 400);
  const row = await db.select({ meaning: termT.meaning }).from(termT).where(eq(termT.term, term)).limit(1);
  if (!row.length) return c.json({ ok: false, error: "术语不存在" }, 404);
  await db.update(termT).set({ meaning: String(body.meaning) }).where(eq(termT.term, term));
  await auditLog("user", "term_update", { term, old: row[0].meaning, new: body.meaning });
  return c.json({ ok: true, term, meaning: body.meaning });
});

memoryRoutes.delete("/api/term/:term", async (c) => {
  const term = c.req.param("term");
  const r = await db.delete(termT).where(eq(termT.term, term)).returning({ id: termT.id });
  if (!r.length || r.length === 0) {
    // pg.rowCount 不可用时以查询复核
    const still = await db.select({ x: termT.id }).from(termT).where(eq(termT.term, term)).limit(1);
    if (still.length) return c.json({ ok: false, error: "术语不存在" }, 404);
  }
  await auditLog("user", "term_delete", { term });
  return c.json({ ok: true, term });
});

memoryRoutes.post("/api/grp/meta", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  await setGrpMeta(String(body.oim_group_id ?? ""), body.intro ?? undefined,
    body.ai_enabled === undefined ? undefined : Number(body.ai_enabled));
  return c.json({ ok: true, meta: await getGrpMeta(String(body.oim_group_id ?? "")) });
});

memoryRoutes.get("/api/grp/meta/:group_id", async (c) => {
  return c.json({ ok: true, meta: await getGrpMeta(c.req.param("group_id")) });
});

memoryRoutes.get("/api/memory", async (c) => {
  const groupId = c.req.query("group_id");
  return c.json({
    ok: true,
    memory: {
      terms: await listTerms(),
      grp_meta: groupId ? await getGrpMeta(groupId) : null,
    },
  });
});
void auditLog;
