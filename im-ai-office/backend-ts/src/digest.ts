import { eq } from "drizzle-orm";
import { db } from "./db/drizzle.js";
import { digestSent, role } from "./db/schema.js";
import { config } from "./config.js";
import { auditLog } from "./repos.js";
import { aiDmSend } from "./aiDm.js";
import { fanout } from "./sse.js";
import { buildDailySummary } from "./memory.js";

// ============ 每日汇总兜底推送（digest.py 的 TS 版；digest_sent 按日期幂等） ============

async function digestAdmins(): Promise<string[]> {
  try {
    const rows = await db.select({ oim_user_id: role.oimUserId })
      .from(role).where(eq(role.role, "admin")).orderBy(role.oimUserId);
    const ids = rows.map((r) => r.oim_user_id).filter(Boolean) as string[];
    return ids.length ? ids : [config.digestFallbackAdmin];
  } catch {
    return [config.digestFallbackAdmin];
  }
}

export async function scanAndPush(now?: Date): Promise<{ pushed: boolean; date: string; reason?: string; to?: string[]; count?: number }> {
  now = now ?? new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const sent = await db.select({ x: digestSent.digestDate }).from(digestSent)
    .where(eq(digestSent.digestDate, dateStr)).limit(1);
  if (sent.length) {
    return { pushed: false, reason: "already_sent", date: dateStr };
  }
  let gate = new Date(now!);
  const [hh, mm] = config.digestTime.split(":");
  gate.setHours(parseInt(hh, 10) || 18, parseInt(mm, 10) || 0, 0, 0);
  if (now < gate) return { pushed: false, reason: "before_time", date: dateStr };

  const sm = await buildDailySummary(dateStr);
  const targets = await digestAdmins();
  for (const t of targets) await aiDmSend(t, sm.text);
  await db.insert(digestSent).values({ digestDate: dateStr, count: sm.count });
  await auditLog("scheduler", "daily_digest_pushed", { date: dateStr, to: targets, count: sm.count });
  fanout("digest", { date: dateStr, to: targets, count: sm.count });
  return { pushed: true, date: dateStr, to: targets, count: sm.count };
}

