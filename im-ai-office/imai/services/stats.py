#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""识别质量统计服务（识别质量统计Spec · 纯读，不写任何数据）

数据源：audit（ai_processed / task_created / identify_ambiguous / confirm / reject /
ai_dedup_skip）+ task（confidence / status / updated_at）。双方言 SQL 限定兼容子集，
时间过滤走 _since_sql 分支（先例：repos.audit_recent）。

实测兼容两种 PG audit 形态（2026-08-31 生产库踩坑）：
- 代码 schema：时间列 ts，detail TEXT
- 生产旧 schema：时间列 created_at，detail JSONB（读出即 dict）
列名运行时探测 + detail 双类型解析，SQLite 固定 ts/str。
"""
import json
import math


def _since_sql(days):
    """窗口起点 SQL 片段（无参数内插，days 已为 int）。函数内读 BACKEND：
    guard_pg 在运行时 monkeypatch，顶层 import 会冻结成错误后端（先例 repos.audit_recent）。"""
    from imai.db import BACKEND
    if BACKEND == "postgres":
        return f"NOW() - INTERVAL '{int(days)} days'"
    return f"datetime('now','-{int(days)} days')"


def _audit_time_col(con):
    """audit 表时间列名：SQLite=ts；PG 探测（代码 schema=ts，生产旧库=created_at）。"""
    from imai.db import BACKEND
    if BACKEND != "postgres":
        return "ts"
    c = con.cursor()
    c.execute("SELECT column_name AS col FROM information_schema.columns "
              "WHERE table_name='audit' AND column_name IN ('ts','created_at')")
    names = {r["col"] for r in c.fetchall()}
    if "ts" in names:
        return "ts"
    if "created_at" in names:
        return "created_at"
    raise RuntimeError("audit 表缺少时间列（ts/created_at）")


def _loads(detail):
    """audit.detail 双类型：PG JSONB 读出即 dict；TEXT/SQLite 为 JSON 字符串。"""
    if isinstance(detail, dict):
        return detail
    try:
        return json.loads(detail or "{}")
    except (ValueError, TypeError):
        return {}


def _audit_counts(con, since_sql, tcol):
    """窗口内按 action 计数（两个后端均为映射式行：别名+字典访问）。"""
    c = con.cursor()
    c.execute(f"SELECT action AS a, COUNT(*) AS n FROM audit WHERE {tcol} >= {since_sql} GROUP BY action")
    return {r["a"]: r["n"] for r in c.fetchall()}


def _percentile(sorted_vals, p):
    """最近邻秩分位（nearest-rank）：小数据量下双方言安全、不引窗口函数。"""
    if not sorted_vals:
        return None
    idx = max(0, math.ceil(p * len(sorted_vals)) - 1)
    return sorted_vals[idx]


def _reject_reasons(con, since_sql, tcol):
    c = con.cursor()
    c.execute(f"SELECT detail AS d FROM audit WHERE action='reject' AND {tcol} >= {since_sql}")
    reasons = {}
    for r in c.fetchall():
        reason = (_loads(r["d"]).get("reason") or "").strip() or "(未填原因)"
        reasons[reason] = reasons.get(reason, 0) + 1
    return [{"reason": k, "n": v} for k, v in
            sorted(reasons.items(), key=lambda kv: -kv[1])]


def _confidence_breakdown(con):
    """置信度校准：task 表按 confidence 分组 × 实际 confirm/reject 终态（全量累计）。"""
    c = con.cursor()
    c.execute("SELECT confidence AS conf, COUNT(*) AS n, "
              "SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS cf, "
              "SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rj "
              "FROM task WHERE confidence IS NOT NULL GROUP BY confidence")
    return [{"confidence": r["conf"] or "(空)", "created": r["n"], "confirm": r["cf"] or 0, "reject": r["rj"] or 0}
            for r in c.fetchall()]


def _pending_stale(con, stale_hours=48):
    """挂起任务：pending_* 且超 stale_hours 未被处理（疑似误判代理信号）。"""
    from imai.db import BACKEND
    c = con.cursor()
    if BACKEND == "postgres":
        # PG 翻译游标下 LIKE 的 % 需写成 %%（psycopg2 空参数也做插值，迭代2-Spec 踩坑）
        c.execute("SELECT id, content, status, "
                  "EXTRACT(EPOCH FROM (NOW() - updated_at))/3600.0 FROM task "
                  f"WHERE status LIKE 'pending%%' AND updated_at IS NOT NULL "
                  f"AND updated_at < NOW() - INTERVAL '{int(stale_hours)} hours'")
    else:
        c.execute("SELECT id, content, status, "
                  "(julianday('now') - julianday(updated_at)) * 24.0 FROM task "
                  "WHERE status LIKE 'pending%' AND updated_at IS NOT NULL "
                  f"AND updated_at < datetime('now','-{int(stale_hours)} hours')")
    return [{"taskId": i, "content": (ct or "")[:60], "status": st, "age_hours": round(ag, 1)}
            for i, ct, st, ag in c.fetchall()]


def _latencies(con, since_sql, tcol):
    c = con.cursor()
    c.execute(f"SELECT detail AS d FROM audit WHERE action='ai_processed' AND {tcol} >= {since_sql}")
    vals = []
    for r in c.fetchall():
        ms = _loads(r["d"]).get("latency_ms")
        if isinstance(ms, (int, float)):
            vals.append(ms)
    return sorted(vals)


def _cancelled_count(con, since_sql, tcol):
    """取消数：task_update 审计中 detail 含 cancelled（改负责人/改期也是 task_update，需区分）。
    生产旧库 detail 为 JSONB 不能直接 LIKE，PG 统一转 ::text（代码 schema 的 TEXT 也兼容）。"""
    c = con.cursor()
    from imai.db import BACKEND
    detail_col = "detail::text" if BACKEND == "postgres" else "detail"
    like_cancelled = "%%cancelled%%" if BACKEND == "postgres" else "%cancelled%"
    c.execute(f"SELECT COUNT(*) AS n FROM audit WHERE action='task_update' "
              f"AND {detail_col} LIKE '{like_cancelled}' AND {tcol} >= {since_sql}")
    return c.fetchone()["n"]


def quality_report(con, days=7):
    """汇总识别质量指标。days: 统计窗口（天）。纯读。"""
    since = _since_sql(days)
    tcol = _audit_time_col(con)
    counts = _audit_counts(con, since, tcol)

    confirm = counts.get("confirm", 0)
    reject = counts.get("reject", 0)
    denom = confirm + reject
    one_pass = round(confirm / denom, 4) if denom else None

    lat = _latencies(con, since, tcol)

    return {
        "ok": True,
        "window_days": int(days),
        "totals": {
            "processed": counts.get("ai_processed", 0),
            "task_created": counts.get("task_created", 0),
            "ambiguous": counts.get("identify_ambiguous", 0),
            "confirm": confirm,
            "reject": reject,
            "cancelled": _cancelled_count(con, since, tcol),
            "dedup_skipped": counts.get("ai_dedup_skip", 0),
        },
        "one_pass_rate": one_pass,
        "reject_reasons": _reject_reasons(con, since, tcol),
        "confidence": _confidence_breakdown(con),
        "pending_stale": _pending_stale(con),
        "latency": {
            "n": len(lat),
            "p50_ms": _percentile(lat, 0.50),
            "p95_ms": _percentile(lat, 0.95),
        },
    }
