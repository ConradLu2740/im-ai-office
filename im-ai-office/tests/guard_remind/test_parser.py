#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""deadline_parser 单测（迭代 1 补齐；Spec §1.2 各模式 + 失败路径）

固定 now=2026-08-28（周五），全部断言确定性。
"""
from datetime import datetime

from imai.services.deadline_parser import parse

# 2026-08-28 = 周五（weekday=4）
NOW = datetime(2026, 8, 28, 10, 0)


def _d(m, d):
    return datetime(2026, m, d, 23, 59)


def test_today():
    assert parse("今天", NOW) == _d(8, 28)


def test_tomorrow():
    assert parse("明天", NOW) == _d(8, 29)


def test_day_after_tomorrow():
    assert parse("大后天", NOW) == _d(8, 31)


def test_n_days_later():
    assert parse("3天后", NOW) == _d(8, 31)


def test_next_week_monday():
    # 下周一 = 下一周的周一：8-28(五) + 3 天 = 8-31
    assert parse("下周一", NOW) == _d(8, 31)


def test_next_week_sunday():
    assert parse("下周日", NOW) == _d(9, 6)


def test_weekday_today_when_same_day():
    # 周五说"周五" → 指今天
    assert parse("周五", NOW) == _d(8, 28)


def test_weekday_future():
    # 周日 = 最近未来的周日：+2 天
    assert parse("周日", NOW) == _d(8, 30)


def test_month_day_this_month():
    assert parse("31号", NOW) == _d(8, 31)


def test_month_day_passed_goes_next_month():
    assert parse("5号", NOW) == _d(9, 5)


def test_month_end():
    assert parse("月底", NOW) == _d(8, 31)


def test_suffix_stripped():
    assert parse("周五前", NOW) == parse("周五", NOW)


def test_invalid_returns_none():
    assert parse("尽快", NOW) is None
    assert parse("", NOW) is None
    assert parse(None, NOW) is None


# ============ 时刻点（时刻点Deadline解析Spec，2026-09-02）============
NOW_PM = datetime(2026, 8, 28, 13, 0)


def _t(m, d, h, mi):
    return datetime(2026, m, d, h, mi)


def test_time_only_future_today():
    # 纯时刻点：今天该时刻（now 10:00 < 12:56）
    assert parse("12点56分", NOW) == _t(8, 28, 12, 56)


def test_time_only_passed_goes_tomorrow():
    # 已过则明天
    assert parse("12点56分", NOW_PM) == _t(8, 29, 12, 56)


def test_time_half():
    assert parse("12点半", NOW) == _t(8, 28, 12, 30)


def test_time_colon():
    assert parse("14:30", NOW) == _t(8, 28, 14, 30)


def test_time_afternoon_period():
    assert parse("下午3点", NOW) == _t(8, 28, 15, 0)


def test_time_evening_half():
    assert parse("晚上8点半", NOW) == _t(8, 28, 20, 30)


def test_date_with_time_tomorrow():
    assert parse("明天下午3点", NOW) == _t(8, 29, 15, 0)


def test_date_with_time_weekday():
    # 周五 = 今天（周五说周五指今天）+ 下午2点
    assert parse("周五下午2点前", NOW) == _t(8, 28, 14, 0)


def test_date_with_time_month_day():
    # 31号在当月未来（8-28 → 8-31）；注意 25号已过会滚次月（既有规则）
    assert parse("31号上午10点", NOW) == _t(8, 31, 10, 0)


def test_tonight_normalized():
    # 今晚 → 今天晚上，时段折算 20:00
    assert parse("今晚8点", NOW) == _t(8, 28, 20, 0)


def test_invalid_hour_falls_back():
    # 25点非法 → 时刻忽略，无日期词 → None
    assert parse("25点", NOW) is None
