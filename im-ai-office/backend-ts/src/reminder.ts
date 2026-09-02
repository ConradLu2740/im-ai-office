import { config, UNRESOLVED_STATUS } from "./config.js";
import { one, query } from "./db.js";
import { auditLog } from "./repos.js";
import { aiDmSend } from "./aiDm.js";
import { fanout } from "./sse.js";
import { backfillPending } from "./deadline.js";

// ============ 到期提醒调度（reminder.py 的 TS 版；档位规则 1:1） ============

interface TaskLike {
  status?: string | null; assignee?: string | null; creator?: string | null; content?: string | null;
  deadline?: string | null; deadline_at?: Date | string | null; created_at?: Date | string | null;
}

/** deadline_at → 本地 Date。字符串视为本地时间（解析器写入约定）；Date 视为 PG timestamptz。 */
function asLocalDt(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).replace("T", " ").slice(0, 16);
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

/** created_at → 本地 Date（PG timestamptz 直接是绝对时刻）。 */
function createdLocal(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

export function judgeTiers(task: TaskLike, now?: Date): string[] {
  now = now ?? new Date();
  const status = (task.status ?? "").trim();
  const assignee = (task.assignee ?? "").trim();
  const tiers: string[] = [];
  const dl = asLocalDt(task.deadline_at);
  if (status === "confirmed" && assignee && dl) {
    if (now > dl) tiers.push("overdue");
    else {
      if (now.getTime() >= dl.getTime() - 24 * 3600 * 1000) tiers.push("due_24h");
      if (now.toDateString() === dl.toDateString()) tiers.push("due_day");
    }
  }
  const created = createdLocal(task.created_at);
  if ((UNRESOLVED_STATUS as readonly string[]).includes(status) && !assignee && created) {
    if (now.getTime() - created.getTime() >= 24 * 3600 * 1000) tiers.push("unassigned");
  }
  return tiers;
}

function compose(task: TaskLike, tier: string): { text: string; targets: string[] } {
  const content = (task.content ?? "").trim();
  const assignee = (task.assignee ?? "").trim();
  const creator = (task.creator ?? "").trim();
  const dl = asLocalDt(task.deadline_at);
  const pad = (x: number) => String(x).padStart(2, "0");
  const dlStr = dl ? `${pad(dl.getMonth() + 1)}-${pad(dl.getDate())} ${pad(dl.getHours())}:${pad(dl.getMinutes())}` : (task.deadline ?? "");
  if (tier === "due_24h") {
    const text = `⏰ 到期提醒：任务「${content}」将于 ${dlStr}（24 小时内）到期，请留意进度。`;
    const targets = [assignee, ...(creator && creator !== assignee ? [creator] : [])];
    return { text, targets: targets.filter(Boolean) };
  }
  if (tier === "due_day") {
    return { text: `📅 今日到期：任务「${content}」今天（${dlStr}）截止，请推进收尾。`, targets: [assignee].filter(Boolean) };
  }
  if (tier === "overdue") {
    const text = `🔴 逾期提醒：任务「${content}」已超过截止时间（${dlStr}），请尽快处理或更新状态。`;
    const seen = new Set<string>(); const targets: string[] = [];
    for (const x of [assignee, creator]) {
      if (x && !seen.has(x)) { seen.add(x); targets.push(x); }
    }
    return { text, targets };
  }
  return { text: `🔔 任务「${content}」发布超过 24 小时还没有负责人认领，请指派或跟进。`, targets: [creator].filter(Boolean) };
}

async function alreadySent(taskId: number, tier: string): Promise<boolean> {
  return (await one("SELECT 1 FROM reminder_sent WHERE task_id=$1 AND tier=$2", [taskId, tier])) !== null;
}

async function markSent(taskId: number, tier: string): Promise<void> {
  await query("INSERT INTO reminder_sent(task_id, tier) VALUES($1,$2) ON CONFLICT (task_id, tier) DO NOTHING", [taskId, tier]);
}

async function maybeGroupWriteback(_task: TaskLike, _text: string): Promise<void> {
  if (!config.remindToGroup) return; // 防骚扰原则：默认关
}

export interface ScanSummary { sent: Array<{ taskId: number; tier: string; text: string }>; }

export async function scanOnce(now?: Date): Promise<ScanSummary> {
  now = now ?? new Date();
  await backfillPending(now);
  const tasks = await query<TaskLike & { id: number }>(
    "SELECT * FROM task WHERE status IN ('confirmed','pending_assignee','pending_confirmation')");
  const sent: Array<{ taskId: number; tier: string; text: string }> = [];
  for (const t of tasks) {
    for (const tier of judgeTiers(t, now)) {
      if (await alreadySent(t.id, tier)) continue;
      const { text, targets } = compose(t, tier);
      for (const target of targets) {
        await aiDmSend(target, text, t.id, "in");
      }
      await auditLog("system", "reminder_sent", { taskId: t.id, tier, targets, text });
      fanout("reminder", { taskId: t.id, tier, targets });
      await markSent(t.id, tier);
      sent.push({ taskId: t.id, tier, text });
    }
  }
  return { sent };
}
void auditLog;
