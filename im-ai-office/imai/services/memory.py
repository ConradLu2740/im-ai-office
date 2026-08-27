#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M4 团队记忆服务（自 core.py:166-308 + 473-494 1:1 迁移）

术语/群简介维护、上下文注入(build_sys_ctx)、溯源(memory_proofs)、修正信号沉淀。
【现状缺陷登记】_memorize_reject_signal 的正则过宽：含『不是/是』等触发词的中性
句子会被误提取人名沉淀 term，由 tests/guard g1_4b 锁定现状；收紧正则时须同步翻转该用例。
"""
import re
from datetime import datetime

from imai.config import UNRESOLVED_STATUS
from imai.repos import audit_log, insert_alias_if_absent, list_term_dicts


def list_terms(con):
    c = con.cursor()
    c.execute("SELECT * FROM term ORDER BY id DESC")
    return [dict(r) for r in c.fetchall()]


def add_term(con, term, meaning, source="manual"):
    """新增术语；若已存在则覆盖 meaning。带审计。"""
    c = con.cursor()
    c.execute("INSERT INTO term(term, meaning, source) VALUES(?,?,?) "
              "ON CONFLICT(term) DO UPDATE SET meaning=excluded.meaning, source=excluded.source",
              (term, meaning, source))
    con.commit()
    audit_log(con, "system", "memorize", {"type": "term", "term": term, "meaning": meaning, "source": source})


def get_grp_meta(con, oim_group_id):
    c = con.cursor()
    c.execute("SELECT * FROM grp_meta WHERE oim_group_id=?", (oim_group_id,))
    row = c.fetchone()
    if not row:
        return {"oim_group_id": oim_group_id, "intro": "", "ai_enabled": 1}
    return dict(row) if isinstance(row, dict) else dict(zip([d[0] for d in c.description], row))


def set_grp_meta(con, oim_group_id, intro=None, ai_enabled=None):
    c = con.cursor()
    cur = get_grp_meta(con, oim_group_id)
    new_intro = intro if intro is not None else cur.get("intro", "")
    new_enabled = ai_enabled if ai_enabled is not None else cur.get("ai_enabled", 1)
    c.execute("INSERT INTO grp_meta(oim_group_id, intro, ai_enabled) VALUES(?,?,?) "
              "ON CONFLICT(oim_group_id) DO UPDATE SET intro=excluded.intro, ai_enabled=excluded.ai_enabled, "
              "updated_at=datetime('now')", (oim_group_id, new_intro, new_enabled))
    con.commit()
    audit_log(con, "system", "set_grp_meta", {"group_id": oim_group_id, "intro": new_intro, "ai_enabled": new_enabled})


def memorize_corrective(con, sender, correction_type, payload):
    """修正信号沉淀：correction_type ∈ person/term/deadline。
    - person: 更新 alias（把称呼绑定到正确 person）
    - term: 新增/覆盖 term
    - deadline: 只更新任务，不沉淀为长期记忆
    """
    if correction_type == "term":
        add_term(con, payload.get("term", ""), payload.get("meaning", ""), source="corrected")
    elif correction_type == "person":
        name = payload.get("name", "")
        person_id = payload.get("person_id")
        if name and person_id:
            # 幂等：该 person 下已有同名 alias 则不重复
            if insert_alias_if_absent(con, person_id, name):
                audit_log(con, f"user:{sender}", "memorize",
                          {"type": "person", "name": name, "person_id": person_id})
    else:
        # deadline 等：只记审计，不作长期记忆
        audit_log(con, f"user:{sender}", "memorize", {"type": correction_type, "payload": payload})


def build_sys_ctx(con, group_id):
    """拼群简介 + 术语 + 人称 作为 system 上下文注入。"""
    from imai.repos import alias_label_rows   # 局部导入避免与 repos 循环无谓的顶部耦合面
    ctx = []
    gm = get_grp_meta(con, group_id)
    if gm.get("intro"):
        ctx.append(f"【群简介】{gm['intro']}")
    terms = list_terms(con)
    if terms:
        ctx.append("【术语】" + "；".join(f"{t['term']}={t['meaning']}" for t in terms))
    names = []
    for r in alias_label_rows(con):
        label = r["real_name"] or r["flower_name"] or ""
        if r["name"] and label and r["name"] != label:
            names.append(f"{r['name']}={label}")
    if names:
        ctx.append("【人称】" + "；".join(sorted(set(names))))
    return "\n".join(ctx)


def list_daily_unconfirmed(con, group_id=None, date=None):
    """列出仍未定归属的任务（pending_assignee / pending_confirmation）。
    date: 可选，'YYYY-MM-DD'；不传则统计当前所有未定归属（含昨日遗留）。
    产品本意“当天未确认→下班前汇总”，即截止到汇总时刻仍未确认的都该兜底。"""
    c = con.cursor()
    if date:
        sql = ("SELECT * FROM task WHERE status IN (?,?) AND date(created_at) = ? "
               "ORDER BY id DESC")
        params = list(UNRESOLVED_STATUS) + [date]
    else:
        sql = "SELECT * FROM task WHERE status IN (?,?) ORDER BY id DESC"
        params = list(UNRESOLVED_STATUS)
    c.execute(sql, params)
    from imai.db import _rows
    return _rows(c)


def build_daily_summary(con, group_id=None, date=None):
    """生成每日待确认汇总文本（兜底：下班前推给群主/管理员）。"""
    tasks = list_daily_unconfirmed(con, group_id, date)
    if not tasks:
        return {"date": date or datetime.now().strftime("%Y-%m-%d"), "count": 0,
                "text": "今日暂无待确认任务 🎉"}
    lines = ["【IMAI 每日汇总】今天还有以下任务未确认归属："]
    for i, t in enumerate(tasks, 1):
        deadline = t.get("deadline") or "未定"
        assignee = t.get("assignee") or "待指派"
        # 若 pending_assignee 且带候选，标注候选
        hit = f"#{t['id']} {t['content']}（发起：{t['creator']}，负责人：{assignee}，截止：{deadline}）"
        lines.append(f"{i}. {hit}")
    lines.append("请群主/管理员及时确认或指派，避免遗漏。")
    return {"date": date or datetime.now().strftime("%Y-%m-%d"),
            "count": len(tasks), "text": "\n".join(lines)}


def memory_proofs(con, text):
    """溯源：扫描文本命中哪些团队记忆（术语/人称），返回依据列表。
    [{type, term, meaning, source}] —— 供确认卡/任务卡片标注「依据：术语 X」"""
    from imai.repos import alias_label_rows
    if not text:
        return []
    proofs = []
    for t in list_terms(con):
        if t["term"] and t["term"] in text:
            proofs.append({"type": "term", "term": t["term"], "meaning": t["meaning"], "source": t["source"]})
    for r in alias_label_rows(con):
        name, real, flower = r["name"], r["real_name"], r["flower_name"]
        # 只要 name 是别名/花名（不等于正名）且出现在文本，就作为依据
        if name and name in text and name != real:
            proofs.append({"type": "person", "term": name, "meaning": real or flower, "source": "alias"})
    return proofs


def _memorize_reject_signal(con, reason, task_id):
    """从驳回理由提取修正信号并沉淀。
    示例 reason: '负责人错了，应该是张敏' → 新增/确认人称映射。
    若正确人名不在 person 表，则以术语笔记形式沉淀（待补 person）。
    【现状缺陷】正则过宽见模块 docstring；g1_4b 哨兵用例锁定。"""
    if not reason:
        return
    m = re.search(r"(?:应该是|是|改为|正确.?(?:负责人|人)?.?:?\s*)([\u4e00-\u9fa5]{2,4})", reason)
    if not m:
        return
    correct_name = m.group(1)
    from imai.repos import find_persons_by_alias
    rows = find_persons_by_alias(con, correct_name)
    if rows:
        return  # 已有人称映射，无需重复
    # 正确人名不在别名/人表 -> 记一条术语级修正信号（待后续补 person）
    memorize_corrective(con, "user", "term", {
        "term": f"人称:{correct_name}",
        "meaning": f"正确负责人人称（待绑定 person，来源 reject 任务#{task_id}）",
    })
