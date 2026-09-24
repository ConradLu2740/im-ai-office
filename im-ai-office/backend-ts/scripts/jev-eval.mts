/**
 * Jev(System One 决策门) vs StepFun(全量意图判定) 评测脚本
 * 语料：生产库 50 条真实中文办公群消息，人工标注 ground truth
 *   t=安排/认领/催办任务（含"没人接"）  c=完成汇报  f=闲聊/协作同步
 * 门的目标：needs_attention = t || c（命中才值得花 3s 跑 StepFun 提取）
 *
 * 用法：
 *   npx tsx scripts/jev-eval.mts --stepfun-only     # 只跑 StepFun 基线（无需 OpenRouter key）
 *   OPENROUTER_API_KEY=sk-or-... npx tsx scripts/jev-eval.mts   # 完整对比
 */
import { readFileSync } from "node:fs";

// ---------- 数据集（content, label） ----------
import { DATA } from "./jev-corpus.js";

// ---------- 环境（.env 由调用方加载或直接 export） ----------
function loadEnv(): void {
  try {
    const raw = readFileSync(new URL("../../.env", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch { /* 无 .env 则用进程环境 */ }
}
loadEnv();

const LLM_BASE = process.env.LLM_BASE ?? "https://api.stepfun.com/v1";
const LLM_KEY = process.env.LLM_API_KEY ?? "";
const LLM_MODEL = process.env.LLM_MODEL ?? "step-3.5-flash";
const TS_KEY = process.env.TYPESAFE_API_KEY ?? "";
const OR_KEY = process.env.OPENROUTER_API_KEY ?? "";
// 优先 TypeSafe 官网直连，其次 OpenRouter
const JEV_MODE: "direct" | "openrouter" | "none" = TS_KEY ? "direct" : OR_KEY ? "openrouter" : "none";

// 与 pipeline.ts INTENT_SYSTEM 逐字一致（评测保真度优先）
const INTENT_SYSTEM =
  "你是办公群聊里的任务识别助手。只在消息确实安排/认领任务时 is_task=true。" +
  "分清：明确指派(@某人或'你负责')=assigned；主动认领('我来')=self；第三人称指派('让小张跟一下')=third_party；无归属=none。" +
  "指出某项具体工作还没人做/没人负责（如'XX还没人做呢'）也是待认领任务：is_task=true、assign_mode=none。" +
  "消息表示某件事/任务已经做完（如'做完了''搞定了''XX已交付'）时：is_task=false、is_completion=true、content=完成的事项；" +
  "纯抱怨或闲聊不是任务；明确否认（'这不是任务'）时 is_task=false。不要臆断。输出严格JSON：" +
  JSON.stringify({
    is_task: "boolean", confidence: "high|medium|low",
    content: "string", assignee_hint: "string|nullable(用'我'表示说话人)",
    deadline_hint: "string|nullable", assign_mode: "assigned|self|third_party|none",
    is_completion: "boolean(消息表示某事已做完时 true，否则 false)",
  });

// ---------- 两个判定器 ----------
interface StepfunVerdict { attention: boolean; is_task: boolean; is_completion: boolean; ms: number; raw?: string }
async function stepfunJudge(msg: string): Promise<StepfunVerdict> {
  const t0 = Date.now();
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LLM_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: INTENT_SYSTEM },
        { role: "user", content: "判断这条群聊消息是否在安排任务；是则提取内容/负责人/截止：\n消息：" + msg },
      ],
    }),
  });
  const j = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = j.choices?.[0]?.message?.content ?? "";
  let is_task = false, is_completion = false;
  try {
    const p = JSON.parse(raw);
    is_task = p.is_task === true || String(p.is_task).toLowerCase() === "true";
    is_completion = p.is_completion === true || String(p.is_completion).toLowerCase() === "true";
  } catch { /* 解析失败 → 全 false（与 pipeline 静默降级一致） */ }
  return { attention: is_task || is_completion, is_task, is_completion, ms: Date.now() - t0, raw };
}

interface JevVerdict { p: number; ms: number; cost?: number }
async function jevJudge(msg: string): Promise<JevVerdict> {
  const t0 = Date.now();
  const questions = {
    needs_attention: {
      type: "noul",
      instructions: "这条中文工作群消息是否需要任务管理系统关注？",
      criteria: {
        true: "安排、认领、催办某项具体工作（含指出某事没人负责），或报告某项工作已完成。",
        false: "闲聊、问候、寒暄，与具体工作安排无关的对话，或纯过去时态的协作同步。",
      },
    },
  };
  const url = JEV_MODE === "direct" ? "https://api.typesafe.ai/v1/systemone" : "https://openrouter.ai/api/alpha/decisions";
  const key = JEV_MODE === "direct" ? TS_KEY : OR_KEY;
  const model = JEV_MODE === "direct" ? "jev-latest" : "typesafe/jev-1.13";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, state: { chat: "工作群聊", message: msg }, questions }),
  });
  const j = await res.json() as { answers?: { needs_attention?: { noul?: number } }; usage?: { cost?: number } };
  return { p: j.answers?.needs_attention?.noul ?? -1, ms: Date.now() - t0, cost: j.usage?.cost };
}

// ---------- 主流程 ----------
const args = process.argv.slice(2);
const stepfunOnly = args.includes("--stepfun-only");

type Row = { msg: string; label: "t" | "c" | "f"; sf?: StepfunVerdict; jev?: JevVerdict };
const rows: Row[] = [];

console.log(`语料 ${DATA.length} 条 | StepFun: ${LLM_MODEL} @ ${LLM_BASE} | Jev: ${stepfunOnly ? "跳过" : JEV_MODE === "direct" ? "jev-latest(官网直连)" : JEV_MODE === "openrouter" ? "jev-1.13(OpenRouter)" : "无 key，跳过"}`);
for (const [msg, label] of DATA) {
  const row: Row = { msg, label };
  row.sf = await stepfunJudge(msg);
  if (!stepfunOnly && JEV_MODE !== "none") row.jev = await jevJudge(msg);
  rows.push(row);
  const flag = row.sf.attention === (label !== "f") ? "✓" : "✗";
  console.log(`${flag} [${label}] sf=${row.sf.attention ? "ATT" : "ign"}${row.sf.is_task ? "(task)" : ""}${row.sf.is_completion ? "(cmp)" : ""} ${row.sf.ms}ms` +
    (row.jev ? ` | jev=${row.jev.p.toFixed(3)} ${row.jev.ms}ms` : "") + ` | ${msg.slice(0, 22)}`);
}

// ---------- 指标 ----------
function pct(x: number): string { return (x * 100).toFixed(1) + "%"; }
function stats(vals: number[]): string {
  if (!vals.length) return "n/a";
  const s = [...vals].sort((a, b) => a - b);
  const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return `p50=${p(0.5)}ms p95=${p(0.95)}ms max=${s[s.length - 1]}ms`;
}

const truth = (r: Row): boolean => r.label !== "f"; // 需要关注
console.log("\n================ 评测结果 ================");

// StepFun 门（attention）指标
{
  const tp = rows.filter((r) => r.sf!.attention && truth(r)).length;
  const fp = rows.filter((r) => r.sf!.attention && !truth(r)).length;
  const fn = rows.filter((r) => !r.sf!.attention && truth(r)).length;
  const tn = rows.filter((r) => !r.sf!.attention && !truth(r)).length;
  console.log(`\n[StepFun 全量门] acc=${pct((tp + tn) / rows.length)} 漏关注(FN)=${fn} 误关注(FP)=${fp}`);
  console.log(`  延迟: ${stats(rows.map((r) => r.sf!.ms))}`);
  const tOk = rows.filter((r) => r.label === "t").filter((r) => r.sf!.is_task).length;
  const cOk = rows.filter((r) => r.label === "c").filter((r) => r.sf!.is_completion).length;
  console.log(`  细分: 任务识别 ${tOk}/${rows.filter((r) => r.label === "t").length}  完成识别 ${cOk}/${rows.filter((r) => r.label === "c").length}`);
  console.log(`  漏判明细: ${rows.filter((r) => !r.sf!.attention && truth(r)).map((r) => `[${r.label}]${r.msg.slice(0, 18)}`).join(" ") || "无"}`);
  console.log(`  误判明细: ${rows.filter((r) => r.sf!.attention && !truth(r)).map((r) => `[${r.label}]${r.msg.slice(0, 18)}`).join(" ") || "无"}`);
}

if (!stepfunOnly && JEV_MODE !== "none" && rows.some((r) => r.jev && r.jev.p >= 0)) {
  console.log(`\n[Jev Noul 门] 延迟: ${stats(rows.filter((r) => r.jev!.p >= 0).map((r) => r.jev!.ms))}`);
  const totalCost = rows.reduce((s, r) => s + (r.jev?.cost ?? 0), 0);
  console.log(`  本次总成本: $${totalCost.toFixed(6)}（单条均价 $${(totalCost / rows.length).toFixed(6)}）`);
  console.log("\n  阈值扫描（p ≥ 阈值 → 送 StepFun）:");
  console.log("  阈值 | 漏关注FN | 误送FP | 门准确率 | 送审率(省调用)");
  for (const th of [0.3, 0.5, 0.7, 0.9]) {
    const tp = rows.filter((r) => (r.jev!.p >= th) === truth(r) && truth(r) && r.jev!.p >= th).length;
    const fn = rows.filter((r) => truth(r) && r.jev!.p < th).length;
    const fp = rows.filter((r) => !truth(r) && r.jev!.p >= th).length;
    const acc = rows.filter((r) => (r.jev!.p >= th) === truth(r)).length / rows.length;
    const sent = rows.filter((r) => r.jev!.p >= th).length / rows.length;
    console.log(`  ${th.toFixed(1)}  | ${String(fn).padStart(2)}      | ${String(fp).padStart(2)}     | ${pct(acc).padStart(7)}  | ${pct(sent)}`);
  }
  console.log(`\n  分歧案例（Jev 与标注不一致）:`);
  for (const r of rows) {
    if ((r.jev!.p >= 0.5) !== truth(r)) console.log(`    jev=${r.jev!.p.toFixed(3)} 标注=${r.label} sf=${r.sf!.attention ? "ATT" : "ign"} | ${r.msg}`);
  }
  // 组合门延迟估算：FN 由 StepFun 兜底（漏了也送）时的端到端延迟
  const jevMs = rows.reduce((s, r) => s + r.jev!.ms, 0) / rows.length;
  const sfMs = rows.reduce((s, r) => s + r.sf!.ms, 0) / rows.length;
  const sentRate = rows.filter((r) => r.jev!.p >= 0.5).length / rows.length;
  console.log(`\n  组合延迟估算: Jev门(${jevMs.toFixed(0)}ms) + ${pct(sentRate)}×StepFun(${sfMs.toFixed(0)}ms) ≈ ${(jevMs + sentRate * sfMs).toFixed(0)}ms/条 vs 现状 ${sfMs.toFixed(0)}ms/条`);
}
