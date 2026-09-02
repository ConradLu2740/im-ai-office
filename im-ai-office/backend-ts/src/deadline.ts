import { query } from "./db.js";
import { auditLog } from "./repos.js";

// ============ deadline 自然语言解析器（deadline_parser.py 逐字移植；纯规则、零 LLM） ============
// JS getDay(): 周日=0..周六=6；Python weekday(): 周一=0..周日=6 → pyWd = (getDay()+6)%7

const WEEKDAY_MAP: Record<string, number> = { "一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6 };
const SUFFIX_RE = /(?:之前|以前|之前内|之内|以内|前)$/;
const TIME_RE = /(?:(上午|早上|中午|下午|晚上|傍晚|夜里|晚)\s*)?(?:(\d{1,2}):(\d{2})|(\d{1,2})[点时](?:(\d{1,2})分|半)?)/;
const NORMALIZE: Array<[string, string]> = [["今晚", "今天晚上"], ["明晚", "明天晚上"], ["明早", "明天早上"]];
const EVENING = new Set(["下午", "晚上", "傍晚", "夜里", "晚"]);

const pyWd = (d: Date): number => (d.getDay() + 6) % 7;

function stripSuffix(text: string): string {
  return text.trim().replace(SUFFIX_RE, "");
}

function extractTime(t: string): { time: [number, number] | null; remaining: string } {
  const m = TIME_RE.exec(t);
  if (!m) return { time: null, remaining: t };
  const prefix = m[1];
  let hour: number, minute: number;
  if (m[2] !== undefined) {
    hour = parseInt(m[2], 10); minute = parseInt(m[3], 10);
  } else {
    hour = parseInt(m[4], 10);
    if (m[5] !== undefined) minute = parseInt(m[5], 10);
    else if (m[0].endsWith("半")) minute = 30;
    else minute = 0;
  }
  if (prefix) {
    if (EVENING.has(prefix) && hour < 12) hour += 12;
    else if (prefix === "中午" && hour < 12) hour += 12;
  }
  if (hour > 23 || minute > 59) return { time: null, remaining: t };
  const remaining = (t.slice(0, m.index!) + t.slice(m.index! + m[0].length)).trim();
  return { time: [hour, minute], remaining };
}

function atDayEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59);
}

function atTime(base: Date, h: number, m: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 解析截止短语 → Date（本地时间）或 null。纯时刻点：今天该时刻（已过则明天）。 */
export function parse(text: string | null | undefined, now?: Date): Date | null {
  if (!text) return null;
  now = now ?? new Date();
  let t = stripSuffix(String(text));
  if (!t) return null;
  for (const [a, b] of NORMALIZE) t = t.replace(a, b);
  const { time: timePart, remaining } = extractTime(t);
  t = remaining;

  const final = (day: Date | null): Date | null => {
    if (day === null) {
      if (timePart) {
        const cand = atTime(now!, timePart[0], timePart[1]);
        if (cand.getTime() <= now!.getTime()) cand.setDate(cand.getDate() + 1);
        return cand;
      }
      return null;
    }
    if (timePart) return new Date(day.getFullYear(), day.getMonth(), day.getDate(), timePart[0], timePart[1]);
    return atDayEnd(day);
  };
  const dayOf = (delta: number): Date => {
    const d = new Date(now!); d.setDate(d.getDate() + delta); return d;
  };

  // 相对天数：大后天/后天/明天/今天
  for (const [word, delta] of [["大后天", 3], ["后天", 2], ["明天", 1], ["今天", 0]] as const) {
    if (t === word || t.startsWith(word)) return final(dayOf(delta));
  }
  // N天后 / N天之内
  const mDays = /^(\d{1,3})\s*天(?:后|之内|以内)?$/.exec(t);
  if (mDays) return final(dayOf(parseInt(mDays[1], 10)));
  // 下周X（下周一 = 下一周的周一）
  const mNext = /下(?:一周|个星期|星期|周)([一二三四五六日天])/.exec(t);
  if (mNext) {
    const w = WEEKDAY_MAP[mNext[1]];
    const daysToNextMonday = 7 - pyWd(now!);
    return final(dayOf(daysToNextMonday + w));
  }
  // 周X / 星期X（最近的未来该日；同日指今天）
  const mWeek = /(?:本|这|)?(?:周|星期)([一二三四五六日天])/.exec(t);
  if (mWeek) {
    const w = WEEKDAY_MAP[mWeek[1]];
    let delta = ((w - pyWd(now!)) % 7 + 7) % 7;
    if (delta === 0) {
      delta = 7;
      if (w === pyWd(now!)) delta = 0;
    }
    return final(dayOf(delta));
  }
  // X号 / X日（本月；已过则次月，次月无此日则 null）
  const mDay = /(\d{1,2})[号日]/.exec(t);
  if (mDay) {
    const day = parseInt(mDay[1], 10);
    const mk = (base: Date): Date | null => {
      const cand = new Date(base.getFullYear(), base.getMonth(), day);
      return cand.getDate() === day ? cand : null;   // 次月无此日（如 31 号）→ null
    };
    let candidate = mk(now!);
    if (!candidate) return null;
    if (!sameDay(candidate, now!) && candidate < now!) {
      const nxt = new Date(now!.getFullYear(), now!.getMonth() + 1, 1);
      candidate = mk(nxt);
      if (!candidate) return null;
    }
    return final(candidate);
  }
  // 月底
  if (t.includes("月底")) {
    const nxt = new Date(now!.getFullYear(), now!.getMonth() + 1, 1);
    nxt.setDate(nxt.getDate() - 1);
    return final(nxt);
  }
  return final(null);
}

/** 回填 deadline_at；G4：解析失败记一次 deadline_unparsed（reminder_sent 唯一约束去重）。 */
export async function backfillPending(now?: Date): Promise<number> {
  const rows = await query<{ id: number; deadline: string }>(
    "SELECT id, deadline FROM task WHERE deadline IS NOT NULL AND deadline_at IS NULL");
  let n = 0;
  for (const row of rows) {
    const dt = parse(row.deadline, now);
    if (dt !== null) {
      const pad = (x: number) => String(x).padStart(2, "0");
      const s = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      await query("UPDATE task SET deadline_at=$1 WHERE id=$2", [s, row.id]);
      n += 1;
    } else {
      const r = await query(
        "INSERT INTO reminder_sent(task_id, tier) VALUES($1, 'deadline_unparsed') ON CONFLICT (task_id, tier) DO NOTHING RETURNING id",
        [row.id]);
      if (r.length) await auditLog("system", "deadline_unparsed", { taskId: row.id, deadline: row.deadline });
    }
  }
  return n;
}
