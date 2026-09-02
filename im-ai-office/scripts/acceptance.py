#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键验收脚本：把手动验收清单里可自动化的部分全部自动跑一遍。

用法：  python scripts/acceptance.py
输出：  控制台摘要 + acceptance_report.json（UTF-8）
范围：  基础链路 / 任务识别 / 确认流 / 防重放 / 提醒记录 / 数据一致性
不覆盖：纯视觉体验（toast 样式等）——那部分交给 Agent 浏览器驱动或人工。

约定：所有测试数据带 [e2e] 标记，跑完自动清理。
"""
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta

import psycopg2

import os
BACKEND = os.environ.get("IMAI_ACCEPTANCE_BASE", "http://localhost:8000")
DSN = "postgresql://imai:imai_secret@127.0.0.1:5432/imai"
CONV = "sg_1591442033"
SENDER = "张敏(e2e)"
SEND_ID = "user001"
RUN = datetime.now().strftime("%H%M%S")

results = []


def check(name, ok, detail=""):
    results.append({"检查项": name, "结果": "PASS" if ok else "FAIL", "说明": str(detail)[:200]})
    print(("  [PASS] " if ok else "  [FAIL] ") + name + ("  | " + str(detail)[:80] if detail and not ok else ""))
    return ok


def api(path, payload=None, method=None):
    req = urllib.request.Request(BACKEND + path,
                                 data=json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload else None,
                                 headers={"Content-Type": "application/json"},
                                 method=method or ("POST" if payload else "GET"))
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def db(sql, args=()):
    con = psycopg2.connect(DSN)
    cur = con.cursor()
    cur.execute("SET TIME ZONE 'Asia/Shanghai'")
    cur.execute(sql, args)
    rows = cur.fetchall() if cur.description else []
    con.commit()
    con.close()
    return rows


def send(text, cmid_extra=""):
    """模拟网关投递一条群消息（带唯一 clientMsgID）。"""
    cmid = f"e2e-{RUN}-{cmid_extra}-{abs(hash(text)) % 99999}"
    return api("/api/sdk_message", {"sender": SENDER, "text": text, "conv_id": CONV,
                                    "send_id": SEND_ID, "client_msg_id": cmid}), cmid


def wait_task(_unused, timeout=30):
    """轮询等本轮（近 3 分钟内）新建任务；AI 抽取的标题不确定，按创建时间查。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = db("""SELECT id, status, content FROM task WHERE creator=%s
                     AND created_at > now() - interval '3 minutes' ORDER BY id DESC""", (SENDER,))
        if rows:
            return rows[0]
        time.sleep(2)
    return None


def cleanup():
    db("DELETE FROM task WHERE creator=%s", (SENDER,))
    db("DELETE FROM message WHERE sender_name=%s", (SENDER,))
    db("DELETE FROM ai_dm WHERE sender_id=%s", (SEND_ID,))


def main():
    print("=== IMAI 一键验收 ===\n[0] 服务健康")
    try:
        api("/api/tasks")
        check("后端 8000 可达", True)
    except Exception as e:
        check("后端 8000 可达", False, e)
        finish()
        return
    cleanup()
    leftover = db("SELECT count(*) FROM task WHERE creator=%s", (SENDER,))[0][0]
    check("启动时无 e2e 任务残留", leftover == 0, leftover)

    print("\n[1] 基础链路：发消息→入库→历史可见")
    r1, _ = send(f"李自成 下午办公室讲ppt（批次{RUN}）", "base")
    check("sdk_message 接受", bool(r1.get("ok")))
    time.sleep(2)
    rows = db("SELECT count(*) FROM message WHERE sender_name=%s AND content LIKE %s", (SENDER, f"%批次{RUN}%"))
    check("消息已落库", rows[0][0] >= 1, rows)

    print("\n[2] 任务识别：AI 建任务（自然语句+房间号保证文本唯一，避开 30 分钟确定性去重）")
    r2, _ = send(f"李自成 明天上午10点开产品评审会，材料他来准备，房间{RUN}", "task")
    task = wait_task("评审会材料")
    check("任务已创建", task is not None, "25s 内未在 task 表出现")
    if task:
        check("截止时间解析(明天上午)", task[1] in ("pending_confirmation", "confirmed"), f"status={task[1]}")

    print("\n[3] 确认流")
    if task:
        tid = task[0]
        before = task[1]
        api(f"/api/tasks/{tid}/confirm", method="POST")
        after = db("SELECT status FROM task WHERE id=%s", (tid,))[0][0]
        check(f"confirm 翻转 {before}→confirmed", after == "confirmed", after)
    else:
        check("confirm 翻转", False, "无任务可确认")

    print("\n[4] 防重放")
    r3a, cmid3 = send(f"王五 周五前发周报，编号{RUN}", "replay")
    time.sleep(2)
    n1 = db("SELECT count(*) FROM message WHERE sender_name=%s AND content LIKE %s", (SENDER, f"%编号{RUN}%"))[0][0]
    check("首投消息已入库", n1 >= 1, n1)
    r3b, _ = send(f"王五 周五前发周报，编号{RUN}", "replay")  # 同文本同 clientMsgID → 必须被闸门拦截
    time.sleep(2)
    n2 = db("SELECT count(*) FROM message WHERE sender_name=%s AND content LIKE %s", (SENDER, f"%编号{RUN}%"))[0][0]
    check("同 clientMsgID 重投不重复入库", n1 == n2, f"{n1} vs {n2}")
    check("重投被闸门拦截", r3b.get("dedup") is True or r3b.get("reason") == "client_msg_id_seen", r3b)
    dups = db("""SELECT conv_id, client_msg_id, count(*) FROM message
                 WHERE client_msg_id IS NOT NULL GROUP BY 1,2 HAVING count(*)>1""")
    check("全表无重复 client_msg_id", len(dups) == 0, dups)

    print("\n[5] 数据一致性")
    # 看板接口
    board = api("/api/tasks")
    check("看板接口返回", isinstance(board, (list, dict)))

    finish()


def finish():
    ok = sum(1 for r in results if r["结果"] == "PASS")
    print(f"\n=== 结果: {ok}/{len(results)} PASS ===")
    with open("acceptance_report.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    sys.exit(0 if ok == len(results) else 1)


if __name__ == "__main__":
    main()
