#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Step2 · AI Worker：消费 Redis msg 流 → dedup → pipeline → 动作执行

设计要点（Spec §5）：
- 单 daemon 线程内嵌于 FastAPI 进程（部署形态零变化）；不引入 arq/Celery
- 处理成功后写 event_dedup + XACK；处理异常也 XACK 但记 ai_error 审计（fail-forward，
  防 LLM 持续故障时 pending 雪崩；崩溃在处理中则不写 dedup，可被 reclaim 重试）
- 启动时 XAUTOCLAIM 回收空闲 >60s 的 pending
- Redis 不可达：start_worker_thread 返回 False 并打 ERROR，由调用方降级 sync
"""
import threading
import time

from imai.db import get_conn
from imai.repos import audit_log
from imai.services import bus
from imai.services.actions import execute_ai_actions
from imai.services.bus import (CONSUMER_PREFIX, GROUP, STREAM, ensure_group,
                               is_duplicate, mark_consumed, now_ms,
                               recover_pending)

_stop = threading.Event()
_worker_started = threading.Event()


def _consumer_name():
    import os
    return CONSUMER_PREFIX + str(os.getpid())


def handle_one(r, redis_msg_id, fields):
    """处理单条 message.created 事件。返回 {"status": "processed"|"dedup_skipped"|"error"}。"""
    t0 = time.time()
    msg_id = fields.get("msgId") or str(redis_msg_id)
    content = fields.get("content") or ""
    grp_id = fields.get("grpId") or ""
    sender_id = fields.get("senderId") or ""
    sender_name = fields.get("senderName") or fields.get("senderId") or "未知"

    if not content:
        return {"status": "skipped_empty"}

    con = get_conn()
    try:
        if is_duplicate(con, msg_id):
            audit_log(con, "worker", "ai_dedup_skip", {"msgId": msg_id, "source": fields.get("source")})
            return {"status": "dedup_skipped", "msgId": msg_id}
        result = __import__("imai.services.pipeline", fromlist=["process_message"]).process_message(
            content, sender_name, group_id=grp_id or None)
        executed = execute_ai_actions(result, sender_id=sender_id, group_id=grp_id)
        latency_ms = int((time.time() - t0) * 1000)
        # 成功后才落去重标记（处理中崩溃可由 reclaim 重试）
        mark_consumed(con, msg_id)
        action = result.get("action")
        audit_log(con, "worker", "ai_processed",
                  {"msgId": msg_id, "action": action,
                   "taskId": result.get("task", {}).get("taskId"),
                   "content": (content or "")[:60],
                   "latency_ms": latency_ms, "source": fields.get("source")})
        print(f"[worker] {action} taskId={result.get('task', {}).get('taskId')} "
              f"latency={latency_ms}ms msgId={msg_id}")
        return {"status": "processed", "action": action,
                "result": result, "executed": executed, "latency_ms": latency_ms}
    except Exception as e:
        con2 = get_conn()
        try:
            audit_log(con2, "worker", "ai_error",
                      {"msgId": msg_id, "error": str(e)[:300]})
        finally:
            con2.close()
        return {"status": "error", "error": str(e)}
    finally:
        con.close()


def _consume_loop(r):
    consumer = _consumer_name()
    ensure_group(r)
    reclaimed = recover_pending(r)
    if reclaimed:
        print(f"[worker] 回收 pending {len(reclaimed)} 条: {[str(x) for x in reclaimed[:5]]}")
    for cid in reclaimed:
        r.xack(STREAM, GROUP, cid)   # 已由各自主流程记录，此处仅释放悬挂
    print(f"[worker] 消费就绪 stream={STREAM} group={GROUP} consumer={consumer}")
    while not _stop.is_set():
        try:
            streams = r.xreadgroup(GROUP, consumer, {STREAM: ">"}, count=10, block=5000)
        except Exception as e:
            if _stop.is_set():
                break
            if "NOGROUP" in str(e) or "UNBLOCKED" in str(e):
                # NOGROUP: group 不存在；UNBLOCKED: 阻塞期间 stream 键被删（如 FLUSHALL）
                # 两者都需重建 group/stream 后继续（2026-08-30 Windows 部署实测补）
                try:
                    ensure_group(r)   # 外部 flushdb 后自愈（测试与运维场景）
                except Exception:
                    pass
                continue
            print(f"[worker] xreadgroup 异常(5s后重试): {e}")
            time.sleep(5)
            continue
        for _, items in streams:
            for msg_id, fields in items:
                try:
                    handle_one(r, msg_id, fields)
                except Exception as e:
                    print(f"[worker] handle_one 未捕获异常: {e}")
                finally:
                    try:
                        r.xack(STREAM, GROUP, msg_id)
                    except Exception:
                        pass


def start_worker_thread(r=None) -> bool:
    """启动后台消费线程。Redis 不可达返回 False（调用方降级 sync）。"""
    if _worker_started.is_set():
        return True
    try:
        client = r or bus.make_redis_client()
        client.ping()
    except Exception as e:
        print(f"[worker] ERROR: Redis 不可达({e})，降级为同步 AI 路径；"
              f"请检查 IMAI_REDIS_URL 与 redis 服务后重启")
        return False

    def _run():
        _consume_loop(client)

    t = threading.Thread(target=_run, daemon=True, name="imai-ai-worker")
    t.start()
    _worker_started.set()
    return True


def stop_worker():
    _stop.set()


if __name__ == "__main__":
    """独立进程模式（可选）：python3 -m imai.worker —— 单机默认内嵌线程即可，此入口备用。"""
    ok = start_worker_thread()
    if not ok:
        raise SystemExit("worker 启动失败：Redis 不可达")
    while True:
        time.sleep(3600)
