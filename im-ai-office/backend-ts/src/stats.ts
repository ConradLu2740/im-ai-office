import { sql } from "drizzle-orm";
import { one, query } from "./db.js";
import { db } from "./db/drizzle.js";

// ============ 识别质量统计（stats.py 的 TS 版；PG-only） ============
// audit schema 已对齐（drizzle 0000：ts + TEXT detail），运行时探测分支退役。
// 复杂聚合按计划走 sql 模板逃生舱（db.execute）。

async function rows<T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = await db.execute(q);
  return (r as unknown as { rows: T[] }).rows;
}

function loads(detail: unknown): Record<string, unknown> {
  if (detail && typeof detail === "object") return detail as Record<string, unknown>;
  try { return JSON.parse(String(detail ?? "{}")); } catch { return {}; }
}

function percentile(sortedVals: number[], p: number): number | null {
  if (!sortedVals.length) return null;
  const idx = Math.max(0, Math.ceil(p * sortedVals.length) - 1);
  return sortedVals[idx];
}

export async function qualityReport(days = 7): Promise<Record<string, unknown>> {
  const daysInt = Math.floor(days);

  const countRows = await rows<{ a: string; n: string }>(
    sql`SELECT action AS a, COUNT(*)::text AS n FROM audit WHERE ts >= NOW() - INTERVAL ${sql.raw(`'${daysInt} days'`)} GROUP BY action`);
  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.a] = Number(r.n);

  const confirm = counts["confirm"] ?? 0;
  const reject = counts["reject"] ?? 0;
  const denom = confirm + reject;
  const onePass = denom ? Math.round((confirm / denom) * 10000) / 10000 : null;

  const latRows = await rows<{ d: unknown }>(
    sql`SELECT detail AS d FROM audit WHERE action='ai_processed' AND ts >= NOW() - INTERVAL ${sql.raw(`'${daysInt} days'`)}`);
  const lat = latRows
    .map((r) => loads(r.d)["latency_ms"])
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);

  const rejectRows = await rows<{ d: unknown }>(
    sql`SELECT detail AS d FROM audit WHERE action='reject' AND ts >= NOW() - INTERVAL ${sql.raw(`'${daysInt} days'`)}`);
  const reasons: Record<string, number> = {};
  for (const r of rejectRows) {
    const reason = String(loads(r.d)["reason"] ?? "").trim() || "(未填原因)";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const rejectReasons = Object.entries(reasons)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([reason, n]) => ({ reason, n }));

  const confRows = await rows<{ conf: string | null; n: string; cf: string; rj: string }>(
    sql`SELECT confidence AS conf, COUNT(*)::text AS n,
            SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END)::text AS cf,
            SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END)::text AS rj
     FROM task WHERE confidence IS NOT NULL GROUP BY confidence`);
  const confidence = confRows.map((r) => ({
    confidence: r.conf || "(空)", created: Number(r.n), confirm: Number(r.cf), reject: Number(r.rj),
  }));

  const staleRows = await rows<{ id: number; content: string; status: string; age: string }>(
    sql`SELECT id, content, status, (EXTRACT(EPOCH FROM (NOW() - updated_at))/3600.0)::text AS age FROM task
     WHERE status LIKE 'pending%' AND updated_at IS NOT NULL AND updated_at < NOW() - INTERVAL '48 hours'`);
  const pendingStale = staleRows.map((r) => ({
    taskId: r.id, content: (r.content || "").slice(0, 60), status: r.status, age_hours: Math.round(Number(r.age) * 10) / 10,
  }));

  const cancelRow = await one<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM audit WHERE action='task_update' AND detail::text LIKE '%cancelled%' AND ts >= NOW() - ($1 || ' days')::interval",
    [String(daysInt)]);

  return {
    ok: true,
    window_days: daysInt,
    totals: {
      processed: counts["ai_processed"] ?? 0,
      task_created: counts["task_created"] ?? 0,
      ambiguous: counts["identify_ambiguous"] ?? 0,
      confirm, reject,
      cancelled: Number(cancelRow?.n ?? 0),
      dedup_skipped: counts["ai_dedup_skip"] ?? 0,
    },
    one_pass_rate: onePass,
    reject_reasons: rejectReasons,
    confidence,
    pending_stale: pendingStale,
    latency: {
      n: lat.length,
      p50_ms: percentile(lat, 0.5),
      p95_ms: percentile(lat, 0.95),
    },
  };
}
