#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Step2 · 事件总线：Redis Streams 生产/消费 + 进程内 SSE fan-out

协议对齐 oim-webhook 既有字段（event/msgId/grpId/senderId/content/type/at），
worker 以独立 consumer group 消费同一 msg 流，与旧 ai-agent 组广播隔离。
测试隔离约定：Guard 用 db15（FLUSHDB 起止），生产默认 db0。
"""
import hashlib
import json
import threading
from datetime import datetime, timezone

from imai import config

STREAM = "msg"
GROUP = "imai-core-worker"
CONSUMER_PREFIX = "c"

_event_name = "message.created"

# ---- SSE fan-out（进程内订阅者队列注册表）----
_subs_lock = threading.Lock()
_subscribers = []          # list[queue.Queue]


def now_ms():
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def make_redis_client(db=None):
    """构造 Redis 客户端；db 为 None 时用 REDIS_URL 原样（生产 db0）。

    运行时读取 config.REDIS_URL（非 import 冻结）：测试 fixture 通过
    setattr(config, "REDIS_URL", ...) 切换隔离库时，投递/消费/flush 三方保持一致。"""
    import redis
    url = config.REDIS_URL
    if db is not None:
        base = url.rsplit("/", 1)[0]
        url = f"{base}/{db}"
    return redis.Redis.from_url(url, decode_responses=True)


def deterministic_msg_id(conv_id, sender, text):
    """确定性幂等键：同会话+同发送者+同文本 → 同 msgId（配合去重窗口语义）。"""
    raw = f"{conv_id}|{sender}|{text}"
    return "evt_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def publish_message(r, conv_id, sender_id, sender_name, text,
                    msg_id=None, source="local"):
    """发布一条 message.created 事件到流。返回 Redis 流内 id。"""
    fields = {
        "event": _event_name,
        "msgId": msg_id or deterministic_msg_id(conv_id, sender_id, text),
        "grpId": conv_id or "",
        "senderId": sender_id or "",
        "senderName": sender_name or "",
        "content": text or "",
        "type": "text",
        "at": str(now_ms()),
        "source": source,
    }
    return r.xadd(STREAM, fields)


def ensure_group(r):
    """确保 consumer group 存在（mkstream 兼容空流；BUSYGROUP 视为已存在）。"""
    try:
        r.xgroup_create(STREAM, GROUP, id="0", mkstream=True)
    except Exception as e:
        if "BUSYGROUP" not in str(e):
            raise


def recover_pending(r, min_idle_ms=60000, count=100):
    """启动时回收空闲超过阈值的 pending 消息给当前消费者（防崩丢）。"""
    try:
        _, claimed, _ = r.xautoclaim(STREAM, GROUP, CONSUMER_PREFIX + "reclaim",
                                     min_idle_time=min_idle_ms, start_id="0-0", count=count)
        return [cid for cid, _ in claimed]
    except Exception:
        return []


# ---- dedup（SQLite 侧，窗口语义见 Spec §4）----

def is_duplicate(con, msg_id):
    """30 分钟窗口内的 msgId 视为重复。"""
    c = con.cursor()
    c.execute(
        "SELECT 1 FROM event_dedup WHERE msg_id=? "
        "AND consumed_at > datetime('now', ?)", (msg_id, f"-{config.DEDUP_WINDOW_SEC} seconds"))
    return c.fetchone() is not None


def mark_consumed(con, msg_id):
    c = con.cursor()
    c.execute("INSERT OR REPLACE INTO event_dedup(msg_id) VALUES(?)", (msg_id,))
    con.commit()


# ---- 进程内 fan-out（SSE 数据源；与 Redis 消费解耦）----

def subscribe():
    q = __import__("queue").Queue(maxsize=256)
    with _subs_lock:
        _subscribers.append(q)
    return q


def unsubscribe(q):
    with _subs_lock:
        if q in _subscribers:
            _subscribers.remove(q)


def fanout(event_type, payload):
    """向全部 SSE 订阅者广播一个 JSON 事件；队列满则丢弃（实时通知，允许丢帧）。"""
    data = {"type": event_type, "ts": now_ms(), **(payload or {})}
    line = json.dumps(data, ensure_ascii=False)
    with _subs_lock:
        targets = list(_subscribers)
    for q in targets:
        try:
            q.put_nowait(line)
        except Exception:
            pass
