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

# ============ LLM provider：已切换为 DeepSeek 官方 API ============
# 迭代2：瞬时空响应/网络错误自动重试；总尝试 = 1 + LLM_RETRIES；4xx(非408/429) 不重试
LLM_RETRIES = int(os.environ.get("IMAI_LLM_RETRIES", "2"))

# OpenIM 服务端接入（自旧 app.py 迁移）
OPENIM_API = os.environ.get("OPENIM_API", "http://127.0.0.1:10002")
OPENIM_ADMIN_TOKEN = os.environ.get("OPENIM_ADMIN_TOKEN", "")
OPENIM_SECRET = os.environ.get("OPENIM_SECRET", "openIM123")

# ============ Step2 事件化（AI 异步模式）============
# sync（默认）：入口同步跑 AI，行为与 Step1 完全一致；async：入队即返回，worker 后台消费
AI_MODE = os.environ.get("IMAI_AI_MODE", "sync")
REDIS_URL = os.environ.get("IMAI_REDIS_URL", "redis://127.0.0.1:6379/0")
DEDUP_WINDOW_SEC = int(os.environ.get("IMAI_DEDUP_WINDOW_SEC", "1800"))  # 同 msgId 去重窗口

# 进程内事件队列（模拟 Redis Streams；真实环境用 Redis）
# 单例共享：pipeline 写入、routes 读取，严禁各处另建 list。
EVENTS = []

# ============ 领域常量 ============
# 高风险动作：AI 不能直接执行，须人工批准
HIGH_RISK_ACTIONS = {"assign_notify", "dm_send", "delete_task", "broadcast"}

# 每日汇总要覆盖的“未定归属”状态
UNRESOLVED_STATUS = ("pending_assignee", "pending_confirmation")

# ============ 迭代1 补齐：到期提醒调度 ============
# 调度线程每轮间隔；设为 0 完全关闭（测试基座用它禁线程，直接调 scan_once）
REMIND_INTERVAL_SEC = int(os.environ.get("IMAI_REMIND_INTERVAL_SEC", "60"))
# 提醒是否回写 OpenIM 群（默认关：防骚扰原则，Spec §1.3）
REMIND_TO_GROUP = os.environ.get("IMAI_REMIND_TO_GROUP", "0") == "1"

# ============ 每日汇总兑底（M2 收尾） ============
# 本地时间到达后当日首次扫描即推送（默认 18:00，下班前）
DIGEST_TIME = os.environ.get("IMAI_DIGEST_TIME", "18:00")
# role 表无 admin 时的兑底收件人
DIGEST_FALLBACK_ADMIN = os.environ.get("IMAI_DIGEST_ADMIN", "user001")
