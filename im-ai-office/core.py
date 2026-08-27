#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""【Step1 过渡垫片 · 将在 P4 删除】全部实现已迁至 imai.* 包。

仅提供旧符号绑定，保证 app.py 主链路在本步骤内零改动持续可运行；
新代码禁止 import 本模块。
"""
from imai.config import (DB_FILE, EVENTS, HIGH_RISK_ACTIONS,     # noqa: F401
                         LLM_API_KEY, LLM_BASE, LLM_MODEL,
                         UNRESOLVED_STATUS)
from imai.db import get_conn, init_db                             # noqa: F401
from imai.integrations.llm_provider import llm_chat               # noqa: F401
from imai.repos import audit_log, message_add, message_list     # noqa: F401
from imai.services.ai_dm import (ai_dm_list, ai_dm_mark_read,     # noqa: F401
                                 ai_dm_send, ai_dm_unread_count,
                                 get_pending_assignee_task,
                                 resolve_assignee_reply,
                                 resolve_task_by_choice)
from imai.services.memory import (add_term, build_daily_summary,   # noqa: F401
                                  build_sys_ctx, get_grp_meta,
                                  list_daily_unconfirmed, list_terms,
                                  memorize_corrective, memory_proofs,
                                  set_grp_meta)
from imai.services.pipeline import (find_by_alias, intent_detect,  # noqa: F401
                                    process_message, resolve, to_bool)
from imai.services.rbac import (can_do, decide_approval, get_role,  # noqa: F401
                                list_approvals, require_approval,
                                set_role)
from imai.services.tasks import confirm_task, reject_task, list_tasks  # noqa: F401


def audit(con, actor, action, detail=None):
    """旧名别名：实现见 imai.repos.audit_log。"""
    return audit_log(con, actor, action, detail)
