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
# 浏览器访问模式的前端目录（web/ = desktop/src 的同源部署副本）
WEB_DIR = ROOT / "web"


def create_app() -> FastAPI:
    """组装应用：中间件、路由、启动任务。"""
    import json as _json
    import os as _os
    from fastapi import Request, Response
    from imai.api import deps
    app = FastAPI(title="对话式 AI 办公 · MVP")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=deps.allowed_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from imai.api import (routes_events, routes_memory, routes_minutes, routes_misc,
                          routes_openim, routes_rbac, routes_stats, routes_tasks)

    app.include_router(routes_tasks.router)
    app.include_router(routes_openim.router)
    app.include_router(routes_rbac.router)
    app.include_router(routes_memory.router)
    app.include_router(routes_misc.router)
    app.include_router(routes_events.router)
    app.include_router(routes_minutes.router)
    app.include_router(routes_stats.router)

    # 浏览器访问模式：/gw/* 同源反代到消息网关（默认 127.0.0.1:8400），免去跨域
    GATEWAY_URL = _os.environ.get("IMAI_GATEWAY_URL", "http://127.0.0.1:8400")

    @app.api_route("/gw/{rest:path}", methods=["GET", "POST"])
    async def gw_proxy(rest: str, request: Request):
        body = await request.body()
        import urllib.request as _ur
        req = _ur.Request(f"{GATEWAY_URL}/gw/{rest}", data=body or None,
                          headers={"Content-Type": request.headers.get("content-type", "application/json")},
                          method=request.method)
        try:
            with _ur.urlopen(req, timeout=35) as resp:
                return Response(content=resp.read(), status_code=resp.status,
                                media_type=resp.headers.get("content-type", "application/json"))
        except Exception as e:
            return Response(content=_json.dumps({"ok": False, "error": str(e)}),
                            status_code=200, media_type="application/json")

    @app.get("/", response_class=HTMLResponse)
    def index():
        web_index = WEB_DIR / "index.html"
        html = (web_index if web_index.exists() else INDEX).read_text(encoding="utf-8")             if (web_index.exists() or INDEX.exists()) else "<h1>请创建 index.html</h1>"
        return HTMLResponse(content=html)

    # 浏览器访问模式：同源挂载前端静态资源（web/ 目录；API 路由优先于挂载）
    if WEB_DIR.exists():
        from fastapi.staticfiles import StaticFiles
        app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")

    @app.on_event("startup")
    def _on_startup():
        from imai import config as _cfg
        routes_openim.gateway_auto_login()
        # Step2：async 模式启动 AI worker 内嵌线程；Redis 不可达自动降级 sync（Spec §5）
        if _cfg.AI_MODE == "async":
            from imai import worker
            if worker.start_worker_thread():
                print(f"[app] AI worker 已启动 (mode={_cfg.AI_MODE})")
            else:
                print("[app] AI worker 启动失败，本次会话降级为 sync 模式")

        # 迭代1 补齐：到期提醒调度线程（sync/async 均启动；REMIND_INTERVAL_SEC=0 关闭，测试基座用它）
        if _cfg.REMIND_INTERVAL_SEC > 0:
            from imai import scheduler
            if scheduler.start_scheduler_thread():
                print(f"[app] 提醒调度已启动 (interval={_cfg.REMIND_INTERVAL_SEC}s)")

    # 启动时初始化数据库（原 app.py 模块级行为保留）
    from imai.db import get_conn as _get_conn, init_db as _init_db
    with _get_conn() as _con:
        _init_db()

    return app


app = create_app()
