#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""到期提醒调度线程（迭代 1 补齐；Spec：提醒调度与缺陷修复Spec.md §1.3）

- daemon 线程，每 REMIND_INTERVAL_SEC（默认 60s，IMAI_REMIND_INTERVAL_SEC 可配）扫描一轮
- create_app startup 启动（与 worker 同型）；线程化故障不外抛，逐轮自愈
- 测试基座经 IMAI_REMIND_INTERVAL_SEC=0 关闭线程，直接调用 services.reminder.scan_once
"""
import threading

from imai.config import REMIND_INTERVAL_SEC
from imai.db import get_conn
from imai.services import reminder

_stop = threading.Event()
_started = threading.Event()


def _loop():
    while not _stop.is_set():
        try:
            con = get_conn()
            try:
                summary = reminder.scan_once(con)
                if summary["sent"]:
                    print(f"[scheduler] 发送提醒 {len(summary['sent'])} 条: "
                          f"{[(s['taskId'], s['tier']) for s in summary['sent']]}")
            finally:
                con.close()
        except Exception as e:
            print(f"[scheduler] 本轮扫描异常(下轮继续): {e}")
        _stop.wait(REMIND_INTERVAL_SEC)


def start_scheduler_thread() -> bool:
    """启动提醒调度线程；重复调用幂等。"""
    if _started.is_set():
        return True
    if REMIND_INTERVAL_SEC <= 0:
        print("[scheduler] REMIND_INTERVAL_SEC=0，提醒调度未启动")
        return False
    t = threading.Thread(target=_loop, daemon=True, name="imai-reminder-scheduler")
    t.start()
    _started.set()
    return True


def stop_scheduler():
    _stop.set()
