#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Step2 · SSE 实时事件流 + AI 异步观测路由

GET /api/events/stream —— text/event-stream；前端 EventSource 订阅
                          （事件源：bus.fanout 的进程内广播，断线由 EventSource 自动重连）
"""
import json
import queue

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from imai.services.bus import subscribe, unsubscribe

router = APIRouter()

KEEPALIVE_SEC = 15


@router.get("/api/events/stream")
def events_stream():
    """SSE 事件流。data 行为 JSON：{"type":"task_created|ai.card|...","ts":ms,...}"""

    def gen():
        q = subscribe()
        try:
            yield ": connected\n\n"          # 注释行：建立即确认连接
            while True:
                try:
                    line = q.get(timeout=KEEPALIVE_SEC)
                    yield f"data: {line}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"   # 心跳防代理断链
        finally:
            unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
