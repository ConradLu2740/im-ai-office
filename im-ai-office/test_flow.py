#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IMAI 办公助手 · 端到端自动化测试（任务闭环回归）

按 测试Spec.md 的用例执行，调用真实后端(8000)/网关(8400)，带断言输出 PASS/FAIL：
  - T3: 模拟群消息 → AI 识别 → 落库（最新任务进「待确认」）
  - T4: 人审确认 → 任务流转到「已确认」
  - T5: AI 识别准确性（负责人/期限/自认领）

用法：
  python3 test_flow.py                # 跑 T3+T4+T5（会新增一条测试任务）
  python3 test_flow.py --dry-run      # 只检查环境与连通性，不改数据
"""
import argparse
import json
import sys
import time
import urllib.request
from collections import Counter

BACKEND = "http://127.0.0.1:8000"
GATEWAY = "http://127.0.0.1:8400"

# 一个可登录的普通用户（imAdmin 是 admin，不能登录）
LOGIN_USER = "user001"

PASS = 0
FAIL = 0


def req(method, url, body=None, timeout=12):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"_raw": e.read().decode()[:200]}
    except Exception as e:
        return 0, {"_error": str(e)}


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ PASS  {name}  {detail}")
    else:
        FAIL += 1
        print(f"  ❌ FAIL  {name}  {detail}")


def get_tasks():
    _, d = req("GET", f"{BACKEND}/api/tasks")
    return d.get("tasks", [])


def status_counts(tasks):
    return Counter(t.get("status") for t in tasks)


def connected_gateway():
    _, d = req("GET", f"{GATEWAY}/gw/ping", timeout=4)
    return d.get("ok", False)


def env_ok():
    print("== 环境检查 ==")
    _, d = req("GET", f"{BACKEND}/api/tasks", timeout=4)
    check("后端(:8000) 可达", "tasks" in d, f"返回{len(d.get('tasks',[]))}条任务")
    check("网关(:8400) 可达", connected_gateway(), "ping ok")
    # 登录可用性
    code, d = req("POST", f"{BACKEND}/openim/login", {"user_id": LOGIN_USER})
    check(f"登录 {LOGIN_USER} 换 token", code == 200 and d.get("ok"),
          f"http={code} err={d.get('error','')}")
    return PASS and not FAIL or FAIL == 0


def test_t3_t5():
    print("\n== T3 + T5: 模拟群消息 → AI 识别 → 落库 ==")
    before = get_tasks()
    before_confirmed = status_counts(before).get("confirmed", 0)

    sender = "测试同事"
    text = "这次618复盘我来出物料清单，下周三前"
    code, d = req("POST", f"{BACKEND}/api/simulate_message",
                  {"sender": sender, "text": text, "conv_id": "sg_test"})
    check("T3: simulate_message 200", code == 200 and d.get("ok"), f"http={code}")

    ai = d.get("ai", {})
    intent = ai.get("intent", {})
    assign = ai.get("assign", {})

    # T5: AI 识别准确性
    check("T5: 识别为任务", intent.get("is_task") is True, f"action={ai.get('action')}")
    check("T5: 识别负责人", assign.get("assignee") == sender or intent.get("assignee_hint") == "我",
          f"assignee={assign.get('assignee')}")
    check("T5: 识别截止时间", "下周三" in (intent.get("deadline_hint") or ""),
          f"deadline={intent.get('deadline_hint')}")
    check("T5: 自认领无歧义", assign.get("mode") == "self" and assign.get("ambiguous") is False,
          f"mode={assign.get('mode')}")

    task = ai.get("task", {})
    check("T3: 任务落库", task and task.get("taskId"),
          f"taskId={task.get('taskId')} status={task.get('status')}")
    check("T3: 新任务进待确认", task.get("status") == "pending_confirmation",
          f"status={task.get('status')}")

    # 看板刷新后新任务可见
    time.sleep(1)
    after = get_tasks()
    new_tasks = [t for t in after if t.get("content") == "出618复盘物料清单"]
    check("T3: 看板可检索到新任务", len(new_tasks) >= 1, f"命中{len(new_tasks)}条")
    return task.get("taskId")


def test_t4(task_id):
    print("\n== T4: 人审确认 → 流转到已确认 ==")
    if not task_id:
        check("T4: 前置任务存在", False, "无 taskId，跳过")
        return
    before = get_tasks()
    before_confirmed = status_counts(before).get("confirmed", 0)

    code, d = req("POST", f"{BACKEND}/api/tasks/{task_id}/confirm", {})
    check("T4: confirm 200", code == 200, f"http={code}")

    time.sleep(1)
    after = get_tasks()
    after_confirmed = status_counts(after).get("confirmed", 0)
    target = [t for t in after if t.get("id") == task_id]
    check("T4: 任务转移到已确认",
          target and target[0].get("status") in ("confirmed", "done"),
          f"status={target[0].get('status') if target else '未找到'}")
    check("T4: 已确认计数增加", after_confirmed == before_confirmed + 1,
          f"{before_confirmed} → {after_confirmed}")


def main():
    parser = argparse.ArgumentParser(prog="test_flow.py", description="IMAI 端到端测试")
    parser.add_argument("--dry-run", action="store_true", help="只检查环境，不改数据")
    args = parser.parse_args()

    if not env_ok():
        print("\n环境未就绪，终止。请先 `python3 cli.py up`")
        sys.exit(1)

    if args.dry_run:
        print("\n(dry-run) 环境检查通过，未修改数据。")
        sys.exit(0)

    task_id = test_t3_t5()
    test_t4(task_id)

    print(f"\n=== 结果: PASS {PASS} / FAIL {FAIL} ===")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
