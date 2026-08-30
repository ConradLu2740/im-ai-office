#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""统一环境引导（DX Spec D2）

所有「独立于 app.py 运行」的入口（诊断脚本、一次性脚本）必须第一行：
    import imai.boot
功能：
1. 注入 .env（已有环境变量优先，不覆盖——与 app.py / conftest 行为一致）
2. report() 显式打印当前连接的存储后端，杜绝「以为连 PG 实际连 SQLite」的暗坑
   （2026-08-30 实测：shell 裸跑脚本静默连 SQLite，与后端 PG 数据对不上，排查多轮）

注意：pytest 不走本模块——conftest 在 import imai 前自行注入 IMAI_DB，管理更精确。
"""
from pathlib import Path

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(_ROOT / ".env")  # override=False：已有环境变量优先


def report() -> str:
    """打印并返回当前存储后端描述。"""
    from imai.db import BACKEND, DATABASE_URL, SQLITE_FILE
    if BACKEND == "postgres":
        # 不打印密码段
        target = DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else DATABASE_URL
    else:
        target = str(SQLITE_FILE)
    line = f"[boot] backend={BACKEND} target={target}"
    print(line)
    return line


report()
