#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""会议纪要服务（迭代2 B2；Spec：迭代2-Spec.md §3）

- generate_minutes：取最近 N 条消息按时间线拼 transcript → llm_chat(json_mode) → 落库 + audit
- minutes_to_task：行动项 → pending_confirmation 任务，走看板正常确认/提醒流
- decisions/action_items 双方言存 JSON TEXT，读取时 json.loads
"""
import json

from imai.repos import audit_log, insert_task

MINUTES_SYSTEM = (
    "你是办公群聊的会议纪要助手。输入是一段按时间排列的群聊记录。"
    "请输出 JSON：{\"title\": 简短会议/讨论主题, \"summary\": 两三句话摘要, "
    "\"decisions\": [达成的结论或决定, ...], "
    "\"action_items\": [{\"content\": 待办事项, \"assignee_hint\": 负责人(原文提及或null), "
    "\"deadline_hint\": 截止时间(原文提及或null)}]}。"
    "只输出 JSON。没有结论则 decisions 为空数组，没有明确待办则 action_items 为空数组，"
    "不要编造聊天记录里不存在的内容。"
)


def _llm():
    """LLM 统一经 imai/llm.py 锚点调用（DX Spec D3），测试 patch llm._impl 即生效。"""
    from imai import llm
    return llm.get_llm()


def _loads(v):
    try:
        return json.loads(v) if v else []
    except (ValueError, TypeError):
        return []


def _row_to_dict(row):
    d = dict(row)
    d["decisions"] = _loads(d.get("decisions"))
    d["action_items"] = _loads(d.get("action_items"))
    return d


def generate_minutes(con, conv_id, limit=50):
    """生成纪要。会话无消息抛 ValueError('no_messages')；LLM 输出非法抛 ValueError('bad_llm')。"""
    c = con.cursor()
    c.execute("SELECT * FROM (SELECT * FROM message WHERE conv_id=? ORDER BY id DESC LIMIT ?) t "
              "ORDER BY id ASC", (conv_id, int(limit)))
    rows = c.fetchall()
    if not rows:
        raise ValueError("no_messages")
    lines = [f"【{r['ts']}】{r['sender_name']}：{r['content']}" for r in rows]
    transcript = "\n".join(lines)
    raw = _llm()(MINUTES_SYSTEM, transcript, json_mode=True)
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        raise ValueError("bad_llm")
    c.execute("INSERT INTO minutes(conv_id, title, summary, decisions, action_items, msg_count) "
              "VALUES(?,?,?,?,?,?)",
              (conv_id, str(data.get("title") or "未命名纪要"), str(data.get("summary") or ""),
               json.dumps(data.get("decisions") or [], ensure_ascii=False),
               json.dumps(data.get("action_items") or [], ensure_ascii=False),
               len(rows)))
    con.commit()
    c.execute("SELECT * FROM minutes WHERE id=?", (c.lastrowid if hasattr(c, "lastrowid") else None,))
    # 兼容 PG 翻译游标：重新按 conv_id + 最新取回
    c.execute("SELECT * FROM minutes WHERE conv_id=? ORDER BY id DESC LIMIT 1", (conv_id,))
    row = c.fetchone()
    audit_log(con, "user", "minutes_generated",
              {"minutesId": row["id"], "convId": conv_id, "msgCount": len(rows)})
    return _row_to_dict(row)


def list_minutes(con, conv_id=None):
    c = con.cursor()
    if conv_id:
        c.execute("SELECT * FROM minutes WHERE conv_id=? ORDER BY id DESC", (conv_id,))
    else:
        c.execute("SELECT * FROM minutes ORDER BY id DESC")
    return [_row_to_dict(r) for r in c.fetchall()]


def get_minutes(con, minutes_id):
    c = con.cursor()
    c.execute("SELECT * FROM minutes WHERE id=?", (minutes_id,))
    row = c.fetchone()
    return _row_to_dict(row) if row else None


def minutes_to_task(con, minutes_id, index):
    """行动项 → 任务。minutes 不存在返回 None；index 越界抛 ValueError('bad_index')。"""
    m = get_minutes(con, minutes_id)
    if not m:
        return None
    items = m["action_items"]
    if not isinstance(index, int) or index < 0 or index >= len(items):
        raise ValueError("bad_index")
    item = items[index]
    tid = insert_task(con, str(item.get("content") or ""), f"minutes#{minutes_id}",
                      item.get("assignee_hint") or None, item.get("deadline_hint") or None,
                      "pending_confirmation", "high", m["title"] or "")
    audit_log(con, "user", "minutes_task_created",
              {"minutesId": minutes_id, "index": index, "taskId": tid})
    return tid
