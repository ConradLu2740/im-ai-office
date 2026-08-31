#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""识别质量周报脚本（识别质量统计Spec §4 P1-d）

用法：
    python scripts/quality_report.py            # 默认最近 7 天
    python scripts/quality_report.py --days 30  # 最近 30 天

输出：UTF-8 文本周报到 stdout（内网工具，人名/原话照实展示，不脱敏）。
只读：不写任何数据。
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import imai.boot  # noqa: F401,E402  统一环境引导（boot import 时自行 report，勿重复调用）

from imai.db import get_conn          # noqa: E402
from imai.services.stats import quality_report  # noqa: E402


def _fmt_rate(v):
    return f"{v * 100:.1f}%" if isinstance(v, (int, float)) else "无数据（窗口内无确认/驳回）"


def main():
    ap = argparse.ArgumentParser(description="IMAI 识别质量周报")
    ap.add_argument("--days", type=int, default=7, help="统计窗口（天，1-365，默认 7）")
    args = ap.parse_args()
    if not (1 <= args.days <= 365):
        sys.exit("--days 需在 1-365 之间")

    con = get_conn()
    try:
        from imai.db import init_db
        init_db()  # 幂等：空库首次跑也能出报告
        r = quality_report(con, days=args.days)
    finally:
        con.close()

    t = r["totals"]
    lines = [
        "=" * 56,
        f"IMAI 识别质量报告（最近 {r['window_days']} 天）",
        "=" * 56,
        f"AI 触达消息      {t['processed']:>6} 条",
        f"建任务           {t['task_created']:>6} 个（歧义分流 {t['ambiguous']}）",
        f"去重拦截         {t['dedup_skipped']:>6} 次",
        "",
        f"一次确认通过率   {_fmt_rate(r['one_pass_rate'])}   （confirm {t['confirm']} / reject {t['reject']}，产品验收线 80%）",
        f"取消任务         {t['cancelled']:>6} 个",
    ]
    if r["reject_reasons"]:
        lines.append("")
        lines.append("驳回原因分布：")
        for it in r["reject_reasons"][:10]:
            lines.append(f"  {it['n']:>3} × {it['reason']}")
    if r["confidence"]:
        lines.append("")
        lines.append("置信度校准（全量累计）：")
        lines.append("  置信度    建卡   确认   驳回")
        for c in r["confidence"]:
            lines.append(f"  {c['confidence']:<8} {c['created']:>5} {c['confirm']:>6} {c['reject']:>6}")
    lat = r["latency"]
    lines.append("")
    if lat["n"]:
        lines.append(f"识别延迟（{lat['n']} 条）：P50 {lat['p50_ms']}ms · P95 {lat['p95_ms']}ms")
    else:
        lines.append("识别延迟：窗口内无数据")
    if r["pending_stale"]:
        lines.append("")
        lines.append(f"⚠ 挂起任务 {len(r['pending_stale'])} 个（pending 超 48h 无人处理，疑似误判）：")
        for s in r["pending_stale"][:10]:
            lines.append(f"  #{s['taskId']} [{s['status']}] 挂起 {s['age_hours']}h · {s['content']}")
    lines.append("=" * 56)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
