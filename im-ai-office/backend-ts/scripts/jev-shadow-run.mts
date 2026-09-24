// 线上 shadow 对账：把语料灌进运行中的后端（shadow 模式），收集 gate 审计，出 agree 率。
// 用法：
//   1) 起后端（imai_test + shadow）：
//      DATABASE_URL=postgresql://imai:imai_secret@127.0.0.1:5432/imai_test \
//        IMAI_TS_PORT=8001 IMAI_REMIND_INTERVAL_SEC=0 node dist/index.js
//   2) npx tsx scripts/jev-shadow-run.mts [baseUrl]
// 前提：.env 里 IMAI_LLM_GATE=jev / IMAI_JEV_MODE=shadow / TYPESAFE_API_KEY=...
import { DATA } from "./jev-corpus.js";

const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:8001";
const USER = process.env.SMOKE_USER ?? "smokeadmin";
const PASS = process.env.SMOKE_PASS ?? "smoke12345";

async function api(path: string, method = "GET", body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<Record<string, unknown>>;
}

const REPORT_ONLY = process.argv.includes("--report-only");
const login = await api("/api/auth/login", "POST", { username: USER, password: PASS });
const token = String(login.token);
if (!token) { console.error("登录失败：", JSON.stringify(login)); process.exit(1); }

if (!REPORT_ONLY) {
  console.log(`已登录 ${USER} → ${BASE}，开始灌 ${DATA.length} 条语料（shadow：Jev 只记录不拦截）…`);
  let done = 0;
  for (const [msg] of DATA) {
    const r = await api("/api/chat", "POST", { message: msg, sender: "王芳" }, token);
    done += 1;
    if (done % 10 === 0) console.log(`  …${done}/${DATA.length}（最后一条 action=${r.action}）`);
  }
} else {
  console.log(`已登录 ${USER} → ${BASE}，仅拉取对账报告（不灌流量）`);
}

// 拉审计对账（admin 可读；auditRecent 已把 detail 解析为对象，兼容字符串形态）
const audit = await api("/api/audit?limit=500", "GET", undefined, token);
const rows = (audit.audit as Array<{ action: string; detail: unknown }>).filter((r) => r.action.startsWith("jev_"));
console.log(`\n================ shadow 对账报告 ================`);
console.log(`gate 审计行数: ${rows.length}（jev_shadow=${rows.filter((r) => r.action === "jev_shadow").length} jev_skip=${rows.filter((r) => r.action === "jev_skip").length}）`);
const parsed = rows.map((r) => {
  try { return typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail; } catch { return null; }
}).filter(Boolean) as Array<Record<string, unknown>>;
const agreeN = parsed.filter((d) => d.agree === true).length;
console.log(`agree 率: ${((agreeN / parsed.length) * 100).toFixed(1)}% (${agreeN}/${parsed.length})`);
const disagree = parsed.filter((d) => d.agree === false);
if (disagree.length) {
  console.log(`\n分歧明细（Jev 与 StepFun 判定不一致）:`);
  for (const d of disagree) console.log(`  p=${d.p} jev_mode=${d.jev_mode} sf_is_task=${d.sf_is_task} sf_is_completion=${d.sf_is_completion}`);
}
const ps = parsed.map((d) => Number(d.p)).filter((n) => !isNaN(n)).sort((a, b) => a - b);
if (ps.length) {
  console.log(`\nJev 概率分布: min=${ps[0]} p25=${ps[Math.floor(ps.length * 0.25)]} p50=${ps[Math.floor(ps.length * 0.5)]} p75=${ps[Math.floor(ps.length * 0.75)]} max=${ps[ps.length - 1]}`);
  const th = 0.45;
  const wouldSkip = ps.filter((p) => p < th).length;
  console.log(`若切 enforce（阈值 ${th}）: 本批将跳过 ${wouldSkip}/${ps.length} 条（省 ${((wouldSkip / ps.length) * 100).toFixed(0)}% LLM 调用）`);
}
