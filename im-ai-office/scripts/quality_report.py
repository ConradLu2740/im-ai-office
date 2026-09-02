#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""识别质量周报脚本（TS 后端版：改为 /api/stats/quality 的 HTTP 客户端）

用法：
    python scripts/quality_report.py            # 默认最近 7 天
    python scripts/quality_report.py --days 30
    IMAI_BASE=http://localhost:8000 可覆盖后端地址。只读。
"""
import argparse
import json
import os
import urllib.request

BASE = os.environ.get("IMAI_BASE", "http://localhost:8000")


def _fmt_rate(v):
    return f"{v * 100:.1f}%" if isinstance(v, (int, float)) else "无数据（窗口内无确认/驳回）"


def main():
    ap = argparse.ArgumentParser(description="IMAI 识别质量周报")
    ap.add_argument("--days", type=int, default=7, help="统计窗口（天，1-365，默认 7）")
    args = ap.parse_args()
    if not (1 <= args.days <= 365):
        sys_exit("--days 需在 1-365 之间")
    with urllib.request.urlopen(f"{BASE}/api/stats/quality?days={args.days}", timeout=30) as r:
        rep = json.loads(r.read().decode())
    t = rep["totals"]
    lines = [
        "=" * 56,
        f"IMAI 识别质量报告（最近 {rep['window_days']} 天）",
        "=" * 56,
        f"AI 触达消息      {t['processed']:>6} 条",
        f"建任务           {t['task_created']:>6} 个（歧义分流 {t['ambiguous']}）",
        f"去重拦截         {t['dedup_skipped']:>6} 次",
        "",
        f"一次确认通过率   {_fmt_rate(rep['one_pass_rate'])}   （confirm {t['confirm']} / reject {t['reject']}，产品验收线 80%）",
        f"取消任务         {t['cancelled']:>6} 个",
    ]
    if rep["reject_reasons"]:
        lines.append("驳回原因分布：")
        for it in rep["reject_reasons"][:10]:
            lines.append(f"  {it['n']:>3} × {it['reason']}")
    if rep["confidence"]:
        lines.append("置信度校准（task 终态快照）：")
        lines.append("  置信度    建卡   确认   驳回")
        for c in rep["confidence"]:
            lines.append(f"  {c['confidence']:<8} {c['created']:>5} {c['confirm']:>6} {c['reject']:>6}")
    lat = rep["latency"]
    lines.append("")
    lines.append(f"识别延迟（{lat['n']} 条）：P50 {lat['p50_ms']}ms · P95 {lat['p95_ms']}ms" if lat["n"] else "识别延迟：窗口内无数据")
    if rep["pending_stale"]:
        lines.append(f"⚠ 挂起任务 {len(rep['pending_stale'])} 个（pending 超 48h 无人处理，疑似误判）")
    lines.append("=" * 56)
    print("\n".join(lines))


def sys_exit(msg):
    raise SystemExit(msg)


if __name__ == "__main__":
    main()
