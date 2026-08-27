#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FastAPI 应用组装（对外 endpoint 与响应结构 = 旧 app.py 零变化）"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

# imai/api/__init__.py → parents[2] = im-ai-office 根（index.html 所在）
ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "index.html"


def create_app() -> FastAPI:
    """组装应用：中间件、路由、启动任务。"""
    app = FastAPI(title="对话式 AI 办公 · MVP")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from imai.api import routes_memory, routes_misc, routes_openim, routes_rbac, routes_tasks

    app.include_router(routes_tasks.router)
    app.include_router(routes_openim.router)
    app.include_router(routes_rbac.router)
    app.include_router(routes_memory.router)
    app.include_router(routes_misc.router)

    @app.get("/", response_class=HTMLResponse)
    def index():
        html = INDEX.read_text(encoding="utf-8") if INDEX.exists() else "<h1>请创建 index.html</h1>"
        return HTMLResponse(content=html)

    @app.on_event("startup")
    def _on_startup():
        routes_openim.gateway_auto_login()

    # 启动时初始化数据库（原 app.py 模块级行为保留）
    from imai.db import get_conn as _get_conn, init_db as _init_db
    with _get_conn() as _con:
        _init_db()

    return app


app = create_app()
