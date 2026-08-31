#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""B4 历史挖掘路由（Spec：B4历史挖掘Spec.md §4）"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from imai.db import get_conn
from imai.services import mine as mine_svc

router = APIRouter()


class RunIn(BaseModel):
    conv_id: str
    limit: int = 500
    batch: int = 100


class DecideIn(BaseModel):
    action: str


@router.post("/api/mine/run")
def run(body: RunIn):
    if not (1 <= body.limit <= 2000):
        raise HTTPException(400, "limit 取值 1~2000")
    if not (1 <= body.batch <= 500):
        raise HTTPException(400, "batch 取值 1~500")
    con = get_conn()
    try:
        try:
            r = mine_svc.run_mining(con, body.conv_id, body.limit, body.batch)
        except ValueError as e:
            if str(e) == "no_messages":
                raise HTTPException(400, "该会话没有消息记录")
            raise HTTPException(400, str(e))
        return {"ok": True, **r,
                "candidates": mine_svc.list_candidates(con, status="pending")}
    finally:
        con.close()


@router.get("/api/mine/candidates")
def candidates(status: str = "pending", kind: Optional[str] = None):
    con = get_conn()
    try:
        return {"ok": True, "candidates": mine_svc.list_candidates(con, status, kind)}
    finally:
        con.close()


@router.post("/api/mine/candidates/{cid}/decide")
def decide(cid: int, body: DecideIn):
    con = get_conn()
    try:
        try:
            r = mine_svc.decide_candidate(con, cid, body.action)
        except ValueError as e:
            msg = str(e)
            if msg == "bad_action":
                raise HTTPException(400, "action 只支持 accept/reject")
            if msg == "already_decided":
                raise HTTPException(400, "该候选已处理过")
            if msg == "bad_kind":
                raise HTTPException(400, "未知候选类型")
            raise HTTPException(400, msg)
        if r is None:
            raise HTTPException(404, "候选不存在")
        return {"ok": True, **r}
    finally:
        con.close()
