#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""识别质量统计服务（识别质量统计Spec · 纯读，不写任何数据）

数据源：audit（ai_processed / task_created / identify_ambiguous / confirm / reject /
ai_dedup_skip）+ task（confidence / status / updated_at）。双方言 SQL 限定兼容子集，
时间过滤走 _window/_ago 分支（先例：repos.audit_recent）。
"""
import json
import math

from imai.db import BACKEND


def _audit_counts(con, since_sql):
    """窗口内按 action 计数。"""
    c = con.cursor()
    c.execute(f"SELECT action, COUNT(*) FROM audit WHERE ts >= {since_sql} GROUP BY action",
              ())
    return dict(c.fetchall())


def _since_sql(days):
    """窗口起点 SQL 片段（无参数内插，days 已为 int）。"""
    if BACKEND == "postgres":
        return f"NOW() - INTERVAL '{int(days)} days'"
    return f"datetime('now','-{int(days)} days')"


def _percentile(sorted_vals, p):
    """最近邻秩分位（neatest-rank）：小数据量下双方言安全、不引窗口函数。"""
    if not sorted_vals:
        return None
    idx = max(0, math.ceil(p * len(sorted_vals)) - 1)
    return sorted_vals[idx]


def _reject_reasons(con, since_sql):
    c = con.cursor()
    c.execute(f"SELECT detail FROM audit WHERE action='reject' AND ts >= {since_sql}",
              ())
    reasons = {}
    for (d,) in c.fetchall():
        try:
            reason = (json.loads(d or "{}").get("reason") or "").strip() or "(未填原因)"
        except (ValueError, TypeError):
            reason = "(未填原因)"
        reasons[reason] = reasons.get(reason, 0) + 1
    return [{"reason": k, "n": v} for k, v in
            sorted(reasons.items(), key=lambda kv: -kv[1])]


def _cancelled_count(con, since_sql):
    """取消数：task_update 审计中 detail 含 cancelled（改负责人/改期也是 task_update，需区分）。"""
    c = con.cursor()
    c.execute(f"SELECT COUNT(*) FROM audit WHERE action='task_update' "
              f"AND detail LIKE '%cancelled%' AND ts >= {since_sql}", ())
    return c.fetchone()[0]


def _confidence_breakdown(con):
    """置信度校准：task 表按 confidence 分组 × 实际 confirm/reject 终态。"""
    c = con.cursor()
    c.execute("SELECT confidence, COUNT(*), "
              "SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END), "
              "SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) "
              "FROM task WHERE confidence IS NOT NULL GROUP BY confidence")
    return [{"confidence": conf or "(空)", "created": n, "confirm": cf or 0, "reject": rj or 0}
            for conf, n, cf, rj in c.fetchall()]


def _pending_stale(con, stale_hours=48):
    """挂起任务：pending_* 且超 stale_hours 未被处理（疑似误判代理信号）。"""
    c = con.cursor()
    if BACKEND == "postgres":
        c.execute("SELECT id, content, status, "
                  f"EXTRACT(EPOCH FROM (NOW() - updated_at))/3600.0 FROM task "
                  "WHERE status LIKE 'pending%' AND updated_at IS NOT NULL "
                  "AND updated_at < NOW() - INTERVAL '%s hours'" % int(stale_hours))
    else:
        c.execute("SELECT id, content, status, "
                  "(julianday('now') - julianday(updated_at)) * 24.0 FROM task "
                  "WHERE status LIKE 'pending%' AND updated_at IS NOT NULL "
                  f"AND updated_at < datetime('now','-{int(stale_hours)} hours')")
    return [{"taskId": i, "content": (ct or "")[:60], "status": st, "age_hours": round(ag, 1)}
            for i, ct, st, ag in c.fetchall()]


def _latencies(con, since_sql):
    c = con.cursor()
    c.execute(f"SELECT detail FROM audit WHERE action='ai_processed' AND ts >= {since_sql}",
              ())
    vals = []
    for (d,) in c.fetchall():
        try:
            ms = json.loads(d or "{}").get("latency_ms")
            if isinstance(ms, (int, float)):
                vals.append(ms)
        except (ValueError, TypeError):
            continue
    return sorted(vals)


def quality_report(con, days=7):
    """汇总识别质量指标。days: 统计窗口（天）。纯读。"""
    since = _since_sql(days)
    counts = _audit_counts(con, since)

    confirm = counts.get("confirm", 0)
    reject = counts.get("reject", 0)
    denom = confirm + reject
    one_pass = round(confirm / denom, 4) if denom else None

    lat = _latencies(con, since)

    return {
        "ok": True,
        "window_days": int(days),
        "totals": {
            "processed": counts.get("ai_processed", 0),
            "task_created": counts.get("task_created", 0),
            "ambiguous": counts.get("identify_ambiguous", 0),
            "confirm": confirm,
            "reject": reject,
            "cancelled": _cancelled_count(con, since),
            "dedup_skipped": counts.get("ai_dedup_skip", 0),
        },
        "one_pass_rate": one_pass,
        "reject_reasons": _reject_reasons(con, since),
        "confidence": _confidence_breakdown(con),
        "pending_stale": _pending_stale(con),
        "latency": {
            "n": len(lat),
            "p50_ms": _percentile(lat, 0.50),
            "p95_ms": _percentile(lat, 0.95),
        },
    }
