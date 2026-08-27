#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""deadline 自然语言解析器（纯规则、确定性、零 LLM）

输入示例：周五前 / 下周三前 / 明天 / 3天后 / 25号 / 月底 / 这周内
输出：该「期限日」的 datetime（当天 23:59，语义=当天结束前）；解析失败返回 None。

已知边界（Spec §4）：不含时刻的复杂长句；跨月相对表达（"下下周五"）暂不支持。
"""
import re
from datetime import datetime, timedelta

WEEKDAY_MAP = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}

_SUFFIX_RE = re.compile(r"(?:之前|以前|之前内|之内|以内|前)$")


def _strip_suffix(text):
    return _SUFFIX_RE.sub("", text.strip())


def _at_day_end(base_date):
    return datetime(base_date.year, base_date.month, base_date.day, 23, 59)


def parse(text, now=None):
    """解析截止短语 → datetime（当天 23:59）或 None。"""
    if not text:
        return None
    now = now or datetime.now()
    t = _strip_suffix(str(text))
    if not t:
        return None

    # 相对天数：大后天/后天/明天/今天
    simple = [("大后天", 3), ("后天", 2), ("明天", 1), ("今天", 0)]
    for word, delta in simple:
        if t == word or t.startswith(word):
            return _at_day_end((now + timedelta(days=delta)).date())

    # N天后 / N天后内
    m = re.fullmatch(r"(\d{1,3})\s*天(?:后|之内|以内)?", t)
    if m:
        return _at_day_end((now + timedelta(days=int(m.group(1)))).date())

    # 下周X（下周一 = 下一周的周一）
    m = re.search(r"下(?:一周|个星期|星期|周)([一二三四五六日天])", t)
    if m:
        w = WEEKDAY_MAP[m.group(1)]
        days_to_next_monday = 7 - now.weekday()
        return _at_day_end((now + timedelta(days=days_to_next_monday + w)).date())

    # 周X / 星期X（最近的未来该日，1~7 天内）
    m = re.search(r"(?:本|这|)?(?:周|星期)([一二三四五六日天])", t)
    if m:
        w = WEEKDAY_MAP[m.group(1)]
        delta = (w - now.weekday()) % 7
        if delta == 0:
            delta = 7          # “周五”在周五当天说时指下一个周五？口语更常指今天——取今天
            if w == now.weekday():
                delta = 0
        return _at_day_end((now + timedelta(days=delta)).date())

    # X号 / X日（本月；已过则次月）
    m = re.search(r"(\d{1,2})[号日]", t)
    if m:
        day = int(m.group(1))
        try:
            candidate = now.replace(day=day)
        except ValueError:
            return None
        if candidate.date() < now.date():
            # 次月同日（次月无此日则 None，如 31 号）
            nxt = (now.replace(day=28) + timedelta(days=4)).replace(day=1)
            try:
                candidate = nxt.replace(day=day)
            except ValueError:
                return None
        return _at_day_end(candidate.date())

    # 月底
    if "月底" in t:
        nxt = (now.replace(day=28) + timedelta(days=4)).replace(day=1)
        return _at_day_end((nxt - timedelta(days=1)).date())

    return None


def backfill_pending(con):
    """回填 task.deadline_at 为 NULL 且 deadline 非空的任务。返回回填条数。"""
    c = con.cursor()
    c.execute("SELECT id, deadline FROM task WHERE deadline IS NOT NULL AND deadline_at IS NULL")
    rows = c.fetchall()
    n = 0
    for row in rows:
        text = row["deadline"] if not isinstance(row, dict) else row["deadline"]
        dt = parse(text)
        if dt is not None:
            c.execute("UPDATE task SET deadline_at=? WHERE id=?",
                      (dt.strftime("%Y-%m-%d %H:%M"), row["id"]))
            n += 1
    con.commit()
    return n
