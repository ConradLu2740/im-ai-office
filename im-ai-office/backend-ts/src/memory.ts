import { query, one } from "./db.js";
import { auditLog, listTermDicts, aliasLabelRows, insertAliasIfAbsent, findPersonsByAlias, type TermRow, type TaskRow } from "./repos.js";
import { UNRESOLVED_STATUS } from "./config.js";

// ============ M4 团队记忆服务（memory.py 的 TS 版） ============

export async function listTerms(): Promise<TermRow[]> {
  return listTermDicts();
}

export async function addTerm(term: string, meaning: string, source = "manual"): Promise<void> {
  await query(
    "INSERT INTO term(term, meaning, source) VALUES($1,$2,$3) " +
    "ON CONFLICT(term) DO UPDATE SET meaning=EXCLUDED.meaning, source=EXCLUDED.source",
    [term, meaning, source]);
  await auditLog("system", "memorize", { type: "term", term, meaning, source });
}

export async function getGrpMeta(oimGroupId: string): Promise<{ oim_group_id: string; intro: string; ai_enabled: number }> {
  const row = await one<{ oim_group_id: string; intro: string; ai_enabled: number }>(
    "SELECT * FROM grp_meta WHERE oim_group_id=$1", [oimGroupId]);
  if (!row) return { oim_group_id: oimGroupId, intro: "", ai_enabled: 1 };
  return row;
}

export async function setGrpMeta(oimGroupId: string, intro?: string, aiEnabled?: number): Promise<void> {
  const cur = await getGrpMeta(oimGroupId);
  const newIntro = intro ?? cur.intro;
  const newEnabled = aiEnabled ?? cur.ai_enabled;
  await query(
    "INSERT INTO grp_meta(oim_group_id, intro, ai_enabled) VALUES($1,$2,$3) " +
    "ON CONFLICT(oim_group_id) DO UPDATE SET intro=EXCLUDED.intro, ai_enabled=EXCLUDED.ai_enabled, updated_at=NOW()",
    [oimGroupId, newIntro, newEnabled]);
  await auditLog("system", "set_grp_meta", { group_id: oimGroupId, intro: newIntro, ai_enabled: newEnabled });
}

export async function memorizeCorrective(sender: string, correctionType: string, payload: Record<string, unknown>): Promise<void> {
  if (correctionType === "term") {
    await addTerm(String(payload.term ?? ""), String(payload.meaning ?? ""), "corrected");
  } else if (correctionType === "person") {
    const name = String(payload.name ?? "");
    const personId = payload.person_id as number | undefined;
    if (name && personId) {
      if (await insertAliasIfAbsent(personId, name)) {
        await auditLog(`user:${sender}`, "memorize", { type: "person", name, person_id: personId });
      }
    }
  } else {
    await auditLog(`user:${sender}`, "memorize", { type: correctionType, payload });
  }
}

export async function buildSysCtx(groupId: string): Promise<string> {
  const ctx: string[] = [];
  const gm = await getGrpMeta(groupId);
  if (gm.intro) ctx.push(`【群简介】${gm.intro}`);
  const terms = await listTerms();
  if (terms.length) ctx.push("【术语】" + terms.map((t) => `${t.term}=${t.meaning}`).join("；"));
  const names: string[] = [];
  for (const r of await aliasLabelRows()) {
    const label = r.real_name || r.flower_name || "";
    if (r.name && label && r.name !== label) names.push(`${r.name}=${label}`);
  }
  if (names.length) ctx.push("【人称】" + [...new Set(names)].sort().join("；"));
  return ctx.join("\n");
}

export async function listDailyUnconfirmed(): Promise<TaskRow[]> {
  return query<TaskRow>(
    `SELECT * FROM task WHERE status IN ($1,$2) ORDER BY id DESC`,
    [UNRESOLVED_STATUS[0], UNRESOLVED_STATUS[1]]);
}

export function buildDailySummaryText(tasks: TaskRow[], date?: string | null): { date: string; count: number; text: string } {
  const d = date ?? new Date().toISOString().slice(0, 10);
  if (!tasks.length) return { date: d, count: 0, text: "今日暂无待确认任务 🎉" };
  const lines = ["【IMAI 每日汇总】今天还有以下任务未确认归属："];
  tasks.forEach((t, i) => {
    const deadline = t.deadline || "未定";
    const assignee = t.assignee || "待指派";
    lines.push(`${i + 1}. #${t.id} ${t.content}（发起：${t.creator}，负责人：${assignee}，截止：${deadline}）`);
  });
  lines.push("请群主/管理员及时确认或指派，避免遗漏。");
  return { date: d, count: tasks.length, text: lines.join("\n") };
}

export async function buildDailySummary(date?: string | null): Promise<{ date: string; count: number; text: string }> {
  const tasks = await listDailyUnconfirmed();
  return buildDailySummaryText(tasks, date);
}

export interface Proof { type: string; term: string; meaning: string | null; source: string; }

export async function memoryProofs(text: string): Promise<Proof[]> {
  if (!text) return [];
  const proofs: Proof[] = [];
  for (const t of await listTerms()) {
    if (t.term && text.includes(t.term)) {
      proofs.push({ type: "term", term: t.term, meaning: t.meaning, source: t.source });
    }
  }
  for (const r of await aliasLabelRows()) {
    if (r.name && text.includes(r.name) && r.name !== r.real_name) {
      proofs.push({ type: "person", term: r.name, meaning: r.real_name || r.flower_name, source: "alias" });
    }
  }
  return proofs;
}

/** 从驳回理由提取修正信号并沉淀（正则收紧版：无裸『是』触发词）。 */
export async function memorizeRejectSignal(reason: string, taskId: number): Promise<void> {
  if (!reason) return;
  const m = /(?:应该是|改为|负责人应该是|正确负责人[:：]?\s*|负责人是)([\u4e00-\u9fa5]{2,4})/.exec(reason);
  if (!m) return;
  const correctName = m[1];
  const rows = await findPersonsByAlias(correctName);
  if (rows.length) return;
  await memorizeCorrective("user", "term", {
    term: `人称:${correctName}`,
    meaning: `正确负责人人称（待绑定 person，来源 reject 任务#${taskId}）`,
  });
}
void one;
