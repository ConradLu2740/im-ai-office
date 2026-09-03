#!/usr/bin/env node
// 识别质量周报脚本（quality_report.py 的 Node 移植：/api/stats/quality 的 HTTP 客户端）
// 用法：
//   node scripts/quality-report.mjs             # 默认最近 7 天
//   node scripts/quality-report.mjs --days 30
//   IMAI_BASE=http://localhost:8000 可覆盖后端地址。只读。

const BASE = process.env.IMAI_BASE ?? "http://localhost:8000";

function fmtRate(v) {
  return typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "无数据（窗口内无确认/驳回）";
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const daysIdx = process.argv.indexOf("--days");
let days = 7;
if (daysIdx !== -1) {
  days = parseInt(process.argv[daysIdx + 1], 10);
  if (!Number.isInteger(days) || days < 1 || days > 365) fail("--days 需在 1-365 之间");
}

const res = await fetch(`${BASE}/api/stats/quality?days=${days}`, { signal: AbortSignal.timeout(30000) });
if (!res.ok) fail(`请求失败：HTTP ${res.status}`);
const rep = await res.json();
const t = rep.totals;

const lines = [
  "=".repeat(56),
  `IMAI 识别质量报告（最近 ${rep.window_days} 天）`,
  "=".repeat(56),
  `AI 触达消息      ${String(t.processed).padStart(6)} 条`,
  `建任务           ${String(t.task_created).padStart(6)} 个（歧义分流 ${t.ambiguous}）`,
  `去重拦截         ${String(t.dedup_skipped).padStart(6)} 次`,
  "",
  `一次确认通过率   ${fmtRate(rep.one_pass_rate)}   （confirm ${t.confirm} / reject ${t.reject}，产品验收线 80%）`,
];
if (rep.core && (rep.core.confirm || rep.core.reject)) {
  lines.push(`  └ 真实口径     ${fmtRate(rep.core.one_pass_rate)}   （confirm ${rep.core.confirm} / reject ${rep.core.reject}，排除挖掘/纪要派生与 e2e 流量）`);
}
lines.push(`取消任务         ${String(t.cancelled).padStart(6)} 个`);
if (rep.reject_reasons?.length) {
  lines.push("驳回原因分布：");
  for (const it of rep.reject_reasons.slice(0, 10)) {
    lines.push(`  ${String(it.n).padStart(3)} × ${it.reason}`);
  }
}
if (rep.confidence?.length) {
  lines.push("置信度校准（task 终态快照）：");
  lines.push("  置信度    建卡   确认   驳回");
  for (const c of rep.confidence) {
    lines.push(`  ${String(c.confidence).padEnd(8)} ${String(c.created).padStart(5)} ${String(c.confirm).padStart(6)} ${String(c.reject).padStart(6)}`);
  }
}
const lat = rep.latency;
lines.push("");
lines.push("");
if (lat.n) {
  lines.push(`识别延迟（${lat.n} 条）：P50 ${lat.p50_ms}ms · P95 ${lat.p95_ms}ms`);
  if (rep.latency_by_source?.length) {
    lines.push("  分源明细（send_endpoint 为真实路径，sdk_message 为测试/验收入口）：");
    for (const s of rep.latency_by_source) {
      lines.push(`    ${String(s.source).padEnd(14)} n=${String(s.n).padStart(4)}  P50 ${s.p50_ms ?? "-"}ms · P95 ${s.p95_ms ?? "-"}ms`);
    }
  }
} else {
  lines.push("识别延迟：窗口内无数据");
}
if (rep.pending_stale?.length) {
  lines.push(`⚠ 挂起任务 ${rep.pending_stale.length} 个（pending 超 48h 无人处理，疑似误判）`);
}
lines.push("=".repeat(56));
console.log(lines.join("\n"));
