#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Eval 层 · 意图判定样本集评测（真实 LLM，须显式 --run-eval）

运行： python3 -m pytest tests/eval --run-eval -q
产出： tests/eval/report_baseline.json —— 分类命中率 + 失败明细 + 观察区记录
约定： info_only 样本（E 类疑似承诺）只观察不计失败；F 类误判 ≤1 为初始质量线。
"""
import json
from pathlib import Path

import pytest

EVAL_DIR = Path(__file__).resolve().parent
SAMPLES_FILE = EVAL_DIR / "samples_v1.jsonl"
REPORT_FILE = EVAL_DIR / "report_baseline.json"

SAMPLES = [json.loads(line) for line in
           SAMPLES_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]

RESULTS = []   # (sample, passed, got_summary)


def _judge(sample, resp):
    """返回 (passed: bool|None, got_summary: str)。None=info_only 不计分。"""
    exp = sample.get("expect", {})
    if exp.get("info_only"):
        ai = resp.get("ai", {})
        intent = ai.get("intent", {})
        return None, (f"is_task={intent.get('is_task')} conf={intent.get('confidence')} "
                      f"mode={intent.get('assign_mode')}")

    ai = resp.get("ai", {})
    intent = ai.get("intent") or {}
    assign = ai.get("assign") or {}
    got_is_task = bool(intent.get("is_task"))
    got_mode = intent.get("assign_mode")
    got_ambiguous = bool(assign.get("ambiguous"))
    got_assignee = None if got_ambiguous else (assign.get("assignee") or intent.get("assignee_hint"))
    got_deadline = intent.get("deadline_hint")

    errs = []
    if "is_task" in exp and bool(exp["is_task"]) != got_is_task:
        errs.append(f"is_task 期望 {exp['is_task']} 实得 {got_is_task}")
    if "mode" in exp and exp["mode"] != got_mode:
        errs.append(f"mode 期望 {exp['mode']} 实得 {got_mode}")
    if "ambiguous" in exp and exp["ambiguous"] != got_ambiguous:
        errs.append(f"ambiguous 期望 {exp['ambiguous']} 实得 {got_ambiguous}")
    if "assignee_contains" in exp and not (got_assignee and exp["assignee_contains"] in str(got_assignee)):
        errs.append(f"assignee 需含『{exp['assignee_contains']}』实得 {got_assignee}")
    if "deadline_contains" in exp and not (got_deadline and exp["deadline_contains"] in str(got_deadline)):
        errs.append(f"deadline 需含『{exp['deadline_contains']}』实得 {got_deadline}")
    if exp.get("deadline_none_ok") and got_deadline:
        dl = str(got_deadline)
        # 『尽快』类相对词允许回显；不得臆造出原文不含数字的具体日期
        if any(ch.isdigit() for ch in dl) and not any(ch.isdigit() for ch in sample["text"]):
            errs.append(f"deadline 疑似臆造具体日期：{dl}")
    summary = "; ".join(errs)
    if not summary:
        summary = "非任务，符合预期" if not got_is_task else "全部命中"
    return (len(errs) == 0), summary


@pytest.mark.parametrize("sample", SAMPLES, ids=[s["id"] for s in SAMPLES])
def test_intent_sample(client, run_eval, sample):
    if not run_eval:
        pytest.skip("需 --run-eval 才连接真实 LLM")
    r = client.post("/api/simulate_message",
                    json={"sender": sample["sender"], "text": sample["text"]})
    assert r.status_code == 200, f"{sample['id']} HTTP 异常: {r.status_code}"
    resp = r.json()
    assert resp.get("ok") is True, f"{sample['id']} 后端报错: {resp}"

    passed, summary = _judge(sample, resp)
    RESULTS.append({"id": sample["id"], "category": sample["category"],
                    "text": sample["text"],
                    "result": "info" if passed is None else ("pass" if passed else "fail"),
                    "summary": summary})
    if passed is True:
        assert True
    elif passed is None:
        pytest.skip("info_only 观察样本")     # 计数分离，不污染 pass/fail
    else:
        assert False, f"[{sample['id']}] {sample['text']} → {summary}"


def _write_report():
    hard = [r for r in RESULTS if r["result"] != "info"]
    infos = [r for r in RESULTS if r["result"] == "info"]
    by_cat = {}
    for r in hard:
        c = by_cat.setdefault(r["category"], {"total": 0, "pass": 0})
        c["total"] += 1
        c["pass"] += 1 if r["result"] == "pass" else 0
    f_fail = sum(1 for r in hard if r["category"].startswith("F") and r["result"] == "fail")
    report = {
        "meta": {
            "generated_note": "首轮 AI 质量基线（详见 回归加固Spec.md §5）",
            "hard_total": len(hard),
            "hard_pass": sum(1 for r in hard if r["result"] == "pass"),
            "info_observed": len(infos),
            "f_misfire": f_fail,
            "quality_line_F_le": 1,
        },
        "by_category": by_cat,
        "details": RESULTS,
    }
    REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def test_eval_report_written():
    """收尾：写出报表文件（始终运行，读取上一用例累计的内存结果）。"""
    if RESULTS:
        _write_report()
