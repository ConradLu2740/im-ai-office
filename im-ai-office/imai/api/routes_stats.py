#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""识别质量统计路由（识别质量统计Spec §6）：GET /api/stats/quality"""
from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.get("/api/stats/quality")
def stats_quality(days: int = 7):
    """识别质量报告：一次确认通过率/驳回原因/挂起任务/置信度校准/延迟分位。"""
    if not (1 <= days <= 365):
        raise HTTPException(400, "days 需在 1-365 之间")
    from imai.db import get_conn
    from imai.services.stats import quality_report
    con = get_conn()
    try:
        report = quality_report(con, days=days)
    finally:
        con.close()
    return report
