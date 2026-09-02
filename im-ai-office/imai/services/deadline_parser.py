#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""deadline 自然语言解析器（纯规则、确定性、零 LLM）

输入示例：周五前 / 下周三前 / 明天 / 3天后 / 25号 / 月底 / 这周内
输出：该「期限日」的 datetime（当天 23:59，语义=当天结束前）；解析失败返回 None。

已知边界（Spec §4）：跨月相对表达（"下下周五"）暂不支持；
"晚上12点"按 12:00 处理（口语多指午夜，观察期）。

## 时刻点支持（时刻点Deadline解析Spec，2026-09-02）

新增：N点 / N点半 / N点M分 / N点M / N:MM / N时M分，可带时段前缀
（上午/早上/中午/下午/晚上/傍晚/夜里）；可与日期词组合（"明天下午3点"）。
纯时刻点语义 = 今天该时刻，已过则明天。非法时刻（h>23/m>59）忽略退回纯日期路径。
"""
import re
from datetime import datetime, timedelta

WEEKDAY_MAP = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}

_SUFFIX_RE = re.compile(r"(?:之前|以前|之前内|之内|以内|前)$")

# 时段前缀 + 时刻：N:MM 或 N[点时](M分|半)?
_TIME_RE = re.compile(
    r"(?:(上午|早上|中午|下午|晚上|傍晚|夜里|晚)\s*)?"
    r"(?:(\d{1,2}):(\d{2})|(\d{1,2})[点时](?:(\d{1,2})分|半)?)"
)

# 口语归一化：使剩余文本仍能命中原日期分支
_NORMALIZE = (("今晚", "今天晚上"), ("明晚", "明天晚上"), ("明早", "明天早上"))

_EVENING = ("下午", "晚上", "傍晚", "夜里", "晚")


def _strip_suffix(text):
    return _SUFFIX_RE.sub("", text.strip())


def _extract_time(t):
    """从文本抠出时刻。返回 ((hour, minute), 剩余文本)；无合法时刻返回 (None, t)。"""
    m = _TIME_RE.search(t)
    if not m:
        return None, t
    prefix, ch, cm, h, mn = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
    if ch is not None:
        hour, minute = int(ch), int(cm)
    else:
        hour = int(h)
        if mn is not None:
            minute = int(mn)
        elif m.group(0).endswith("半"):
            minute = 30
        else:
            minute = 0
    if prefix:
        if prefix in _EVENING and hour < 12:
            hour += 12
        elif prefix == "中午" and hour < 12:
            hour += 12
    if hour > 23 or minute > 59:
        return None, t   # 非法时刻整体忽略，退回纯日期路径
    remaining = (t[:m.start()] + t[m.end():]).strip()
    return (hour, minute), remaining


def _at_day_end(base_date):
    return datetime(base_date.year, base_date.month, base_date.day, 23, 59)


def parse(text, now=None):
    """解析截止短语 → datetime 或 None。

    日期词 → 当天 23:59；带时刻 → 该时刻；纯时刻点 → 今天该时刻（已过则明天）。"""
    if not text:
        return None
    now = now or datetime.now()
    t = _strip_suffix(str(text))
    if not t:
        return None
    for a, b in _NORMALIZE:
        t = t.replace(a, b)
    time_part, t = _extract_time(t)

    def _final(day):
        """组装：日期+时刻 / 仅日期(23:59) / 纯时刻(今天，已过则明天)。"""
        if day is None:
            if time_part:
                cand = now.replace(hour=time_part[0], minute=time_part[1],
                                   second=0, microsecond=0)
                if cand <= now:
                    cand += timedelta(days=1)
                return cand
            return None
        if time_part:
            return datetime(day.year, day.month, day.day, time_part[0], time_part[1])
        return _at_day_end(day)

    # 相对天数：大后天/后天/明天/今天
    simple = [("大后天", 3), ("后天", 2), ("明天", 1), ("今天", 0)]
    for word, delta in simple:
        if t == word or t.startswith(word):
            return _final((now + timedelta(days=delta)).date())

    # N天后 / N天后内
    m = re.fullmatch(r"(\d{1,3})\s*天(?:后|之内|以内)?", t)
    if m:
        return _final((now + timedelta(days=int(m.group(1)))).date())

    # 下周X（下周一 = 下一周的周一）
    m = re.search(r"下(?:一周|个星期|星期|周)([一二三四五六日天])", t)
    if m:
        w = WEEKDAY_MAP[m.group(1)]
        days_to_next_monday = 7 - now.weekday()
        return _final((now + timedelta(days=days_to_next_monday + w)).date())

    # 周X / 星期X（最近的未来该日，1~7 天内）
    m = re.search(r"(?:本|这|)?(?:周|星期)([一二三四五六日天])", t)
    if m:
        w = WEEKDAY_MAP[m.group(1)]
        delta = (w - now.weekday()) % 7
        if delta == 0:
            delta = 7          # “周五”在周五当天说时指下一个周五？口语更常指今天——取今天
            if w == now.weekday():
                delta = 0
        return _final((now + timedelta(days=delta)).date())

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
        return _final(candidate.date())

    # 月底
    if "月底" in t:
        nxt = (now.replace(day=28) + timedelta(days=4)).replace(day=1)
        return _final((nxt - timedelta(days=1)).date())

    return _final(None)


def backfill_pending(con, now=None):
    """回填 task.deadline_at 为 NULL 且 deadline 非空的任务。返回回填条数。

    now 可注入（调度器透传其扫描基准时刻），保证可测确定性。"""
    c = con.cursor()
    c.execute("SELECT id, deadline FROM task WHERE deadline IS NOT NULL AND deadline_at IS NULL")
    rows = c.fetchall()
    n = 0
    for row in rows:
        text = row["deadline"] if not isinstance(row, dict) else row["deadline"]
        dt = parse(text, now=now)
        if dt is not None:
            c.execute("UPDATE task SET deadline_at=? WHERE id=?",
                      (dt.strftime("%Y-%m-%d %H:%M"), row["id"]))
            n += 1
    con.commit()
    return n
