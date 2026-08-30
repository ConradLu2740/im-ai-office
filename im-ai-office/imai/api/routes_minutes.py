#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""会议纪要路由（迭代2 B2；Spec：迭代2-Spec.md §3.4）"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from imai.db import get_conn
from imai.services import minutes as minutes_svc

router = APIRouter()


class GenerateIn(BaseModel):
    conv_id: str
    limit: int = 50


class TaskFromMinutesIn(BaseModel):
    index: int


@router.post("/api/minutes/generate")
def generate(body: GenerateIn):
    if body.limit < 1 or body.limit > 500:
        raise HTTPException(400, "limit 取值 1~500")
    con = get_conn()
    try:
        try:
            m = minutes_svc.generate_minutes(con, body.conv_id, body.limit)
        except ValueError as e:
            if str(e) == "no_messages":
                raise HTTPException(400, "该会话没有消息记录")
            raise HTTPException(502, f"LLM 纪要生成失败：{e}")
        return {"ok": True, "minutes": m}
    finally:
        con.close()


@router.get("/api/minutes")
def list_all(conv_id: Optional[str] = None):
    con = get_conn()
    try:
        return {"ok": True, "minutes": minutes_svc.list_minutes(con, conv_id)}
    finally:
        con.close()


@router.get("/api/minutes/{minutes_id}")
def detail(minutes_id: int):
    con = get_conn()
    try:
        m = minutes_svc.get_minutes(con, minutes_id)
        if not m:
            raise HTTPException(404, "纪要不存在")
        return {"ok": True, "minutes": m}
    finally:
        con.close()


@router.post("/api/minutes/{minutes_id}/task")
def to_task(minutes_id: int, body: TaskFromMinutesIn):
    con = get_conn()
    try:
        try:
            tid = minutes_svc.minutes_to_task(con, minutes_id, body.index)
        except ValueError as e:
            if str(e) == "bad_index":
                raise HTTPException(400, "action_items 下标越界")
            raise
        if tid is None:
            raise HTTPException(404, "纪要不存在")
        return {"ok": True, "taskId": tid}
    finally:
        con.close()
