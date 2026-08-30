#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""团队记忆路由（自旧 app.py 1:1 迁移）：术语 / 群简介 / 记忆视图"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from imai.db import get_conn
from imai.repos import audit_log
from imai.services.memory import get_grp_meta, list_terms, set_grp_meta

router = APIRouter()


class TermIn(BaseModel):
    term: str
    meaning: str


class TermMeaningIn(BaseModel):
    meaning: str


class GrpMetaIn(BaseModel):
    oim_group_id: str
    intro: Optional[str] = None
    ai_enabled: Optional[int] = None


@router.get("/api/terms")
def terms():  # 保留 python 内置名? 用复数 endpoint, 函数名 terms 可
    con = get_conn()
    try:
        return {"ok": True, "terms": list_terms(con)}
    finally:
        con.close()


@router.post("/api/term/add")
def term_add(body: TermIn):
    from imai.services.memory import add_term
    con = get_conn()
    try:
        add_term(con, body.term, body.meaning, source="manual")
        return {"ok": True, "term": body.term, "meaning": body.meaning}
    finally:
        con.close()


@router.patch("/api/term/{term}")
def term_update(term: str, body: TermMeaningIn):
    """迭代2 B3：修改术语释义。"""
    if not (body.meaning or "").strip():
        raise HTTPException(400, "meaning 不能为空")
    con = get_conn()
    try:
        c = con.cursor()
        c.execute("SELECT meaning FROM term WHERE term=?", (term,))
        row = c.fetchone()
        if not row:
            raise HTTPException(404, "术语不存在")
        old = row["meaning"] if not isinstance(row, dict) else row.get("meaning")
        c.execute("UPDATE term SET meaning=? WHERE term=?", (body.meaning, term))
        con.commit()
        audit_log(con, "user", "term_update",
                  {"term": term, "old": old, "new": body.meaning})
        return {"ok": True, "term": term, "meaning": body.meaning}
    finally:
        con.close()


@router.delete("/api/term/{term}")
def term_delete(term: str):
    """迭代2 B3：删除术语。audit 留痕。"""
    con = get_conn()
    try:
        c = con.cursor()
        c.execute("DELETE FROM term WHERE term=?", (term,))
        if c.rowcount == 0:
            con.rollback()
            raise HTTPException(404, "术语不存在")
        con.commit()
        audit_log(con, "user", "term_delete", {"term": term})
        return {"ok": True, "term": term}
    finally:
        con.close()


@router.post("/api/grp/meta")
def grp_meta_set(body: GrpMetaIn):
    con = get_conn()
    try:
        set_grp_meta(con, body.oim_group_id, intro=body.intro, ai_enabled=body.ai_enabled)
        return {"ok": True, "meta": get_grp_meta(con, body.oim_group_id)}
    finally:
        con.close()


@router.get("/api/grp/meta/{group_id}")
def grp_meta_get(group_id: str):
    con = get_conn()
    try:
        return {"ok": True, "meta": get_grp_meta(con, group_id)}
    finally:
        con.close()


@router.get("/api/memory")
def memory(group_id: Optional[str] = None):
    """查看团队记忆：术语 + 群简介（+ 术语溯源）。"""
    con = get_conn()
    try:
        return {"ok": True, "memory": {
            "terms": list_terms(con),
            "grp_meta": get_grp_meta(con, group_id) if group_id else None,
        }}
    finally:
        con.close()
