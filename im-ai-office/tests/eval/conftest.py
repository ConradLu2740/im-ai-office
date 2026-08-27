#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Eval 子目录选项：--run-eval 才执行真实 LLM 评测"""
import pytest


def pytest_addoption(parser):
    parser.addoption("--run-eval", action="store_true", default=False,
                     help="连接真实 LLM 跑意图判定样本集（消耗 token）")


@pytest.fixture
def run_eval(request):
    return request.config.getoption("--run-eval")
