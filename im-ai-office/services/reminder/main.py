# 提醒调度：DB 定时扫描 task 到期档位，推送 reminder（简化：打印/写日志 + 写提醒事件）
import os
import time
import json

import psycopg
import redis

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://imai:imai_secret@localhost:5432/imai")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
INTERVAL = int(os.environ.get("REMIND_INTERVAL", "60"))  # 秒

r = redis.Redis.from_url(REDIRECT_URL := REDIS_URL, decode_responses=True)


def scan():
    """每分钟检查：confirmed 任务，按 deadline 分档提醒。"""
    with psycopg.connect(DATABASE_URL) as db:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT id, assignee_id, deadline FROM task
                WHERE status='confirmed' AND deadline IS NOT NULL
                """
            )
            rows = cur.fetchall()
    now = time.time()
    for task_id, assignee, deadline in rows:
        dl_ts = deadline.timestamp()
        diff = dl_ts - now
        if diff < 0:
            tier = "overdue"
        elif diff < 86400:  # 当天(1天内)
            tier = "due"
        elif diff < 2 * 86400:  # 明天(24h 前)
            tier = "soon"
        else:
            continue
        event = {"event": "reminder.due", "taskId": task_id, "assigneeId": assignee, "tier": tier}
        r.xadd("remind", event)
        print(json.dumps(event, ensure_ascii=False))


def main():
    while True:
        try:
            scan()
        except Exception as e:
            print("scan error:", e)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
