#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对话式 AI 办公 · MVP 后端入口（兼容外壳）

实现已迁至 imai/ 包（imai.api.create_app）。保留本文件名与启动方式，
兼容：桌面壳(Tauri lib.rs)、cli.py 编排、`python3 app.py`、uvicorn app:app。
"""
from pathlib import Path

# 时序关键：先注入 .env 再 import imai（LLM_*/DB_FILE 常量在 import 时冻结）
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:
    pass

import os                                                     # noqa: E402
import uvicorn                                                # noqa: E402
from imai.api import app                                      # noqa: E402

if __name__ == "__main__":
    host = os.environ.get("IMAI_HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=8000)
