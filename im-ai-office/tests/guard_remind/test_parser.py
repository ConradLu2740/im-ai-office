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
