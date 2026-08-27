#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全局配置与进程内共享状态（自 core.py 头部 1:1 迁移）

注意：本模块在 import 时冻结环境变量值（LLM_*/DB_FILE），
调用方须保证 load_dotenv 发生在 import 本模块之前。
"""
import os

# ============ 配置（本地单机可覆盖）============
# 默认值指向 DeepSeek 官方 API；真实 key 请通过环境变量或 .env 注入
LLM_BASE = os.environ.get("LLM_BASE", "https://api.deepseek.com/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")
DB_FILE = os.environ.get("IMAI_DB", os.path.join(os.path.dirname(__file__) or ".", "imai.db"))

# 进程内事件队列（模拟 Redis Streams；真实环境用 Redis）
# 单例共享：pipeline 写入、routes 读取，严禁各处另建 list。
EVENTS = []

# ============ 领域常量 ============
# 高风险动作：AI 不能直接执行，须人工批准
HIGH_RISK_ACTIONS = {"assign_notify", "dm_send", "delete_task", "broadcast"}

# 每日汇总要覆盖的“未定归属”状态
UNRESOLVED_STATUS = ("pending_assignee", "pending_confirmation")
