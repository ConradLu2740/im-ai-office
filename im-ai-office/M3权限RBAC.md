# M3 · 权限 RBAC · 可执行 Spec

> 目标：给 AI 与人对操作的分级授权 + 全留痕，让 AI「能读群、能写看板，但高风险动作必须人审、可上诉」，且所有关键动作可溯源。
> 版本：v1 ｜ 依据：技术设计文档 §6（RBAC 授权矩阵）+ 产品一页纸 M3 ｜ 时间：2026-08-23
> 落地范围：在现有 SQLite + Python（core.py / app.py）上做最小可用实现，**不动 OpenIM 服务端**。

---

## 0. 现状基线

| 已有 | 状态 |
|---|---|
| `task` 表 | ✅ 有 status/confidence/assignee 等 |
| `audit` 表 | ✅ 表已建（actor/action/detail/ts），但**写入稀疏，未系统化** |
| `confirm_task` / `reject_task` / `resolve_task_by_choice` | ✅ 已有（人审动作） |
| AI 写看板 | ✅ 可直接写（现状无权限检查） |

**缺口**：无「谁（角色）能做什么」的判定层；高风险动作无 pending 审批；无被指派者上诉通道；审计不完整。

---

## 1. RBAC 授权矩阵（落地版）

| 主体 | 角色 | 读群 | 写看板 | @派发/通知 | 外发/删除/付费 |
|---|---|---|---|---|---|
| 用户 | `member`（群成员） | ✅ | 相关 | ⚠️ 需确认 | ❌ 需审批 |
| 用户 | `group_admin` | ✅ | ✅ | ✅ | ✅(可选开) |
| AI | `ai-group-assistant` | ✅(必须) | ✅(记审计) | ⚠️ 需人审/可上诉 | ❌(默认禁) |

> 落地简化：`member` 与 `group_admin` 用一张 `role` 字段区分；AI 独立角色 `ai-group-assistant`。
> 高风险动作判定：`@派发通知`、`私聊外发`、`删除任务/消息`、`跨群广播` → 标记为 `require_approval`。

---

## 2. 数据模型（增量，SQLite）

```sql
-- 角色：给 OpenIM 用户打角色（member / group_admin）
CREATE TABLE IF NOT EXISTS role (
  oim_user_id TEXT PRIMARY KEY,     -- OpenIM 用户ID
  role        TEXT DEFAULT 'member',-- member | group_admin
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- 高风险动作审批：AI 拟执行但需人工批准的动作
CREATE TABLE IF NOT EXISTS approval (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  oim_user_id TEXT,                 -- 发起者(通常是 AI / ai-group-assistant)
  action      TEXT,                 -- notify_group / dm_send / delete_task / broadcast
  detail      TEXT,                 -- 动作细节 JSON
  status      TEXT DEFAULT 'pending',-- pending | approved | rejected
  created_at  TEXT DEFAULT (datetime('now')),
  decided_at  TEXT,
  decided_by  TEXT
);

-- 上诉：被 @ 者拒绝派发，作为修正信号
-- 复用 task.rejected + audit(action='reject_assign')，extra 字段记 reason
```

> `audit` 表已存在，无需改动字段，但需**系统化写入**（见 §4）。

---

## 3. 权限判定函数（core.py 新增）

```python
def get_role(con, oim_user_id) -> str:
    # 查 role 表；查不到默认 'member'；imAdmin 返回 'group_admin'

def can_do(con, oim_user_id, action) -> tuple[bool, str]:
    """返回 (是否允许, 说明)。
    action ∈ {read_group, write_board, assign_notify, dm_send, delete_task, broadcast}
    读群: ai-group-assistant 必须允许；member 默认允许读自己所在群
    写看板: member 相关 / group_admin / ai(记审计)
    高风险(assign_notify, dm_send, delete_task, broadcast): 一律 require_approval
    """
    if action in HIGH_RISK_ACTIONS:
        return False, "require_approval"   # 走 approval 流程，不直接执行
    ...

def require_approval(con, actor, action, detail) -> int:
    # 插入 approval 表，返回 id；AI 不执行，等待人工批准
```

**关键行为变更**：AI 高风险动作不再直接执行，而是 `insert approval(pending)`；前端看板/桌面端渲染「待审批」区，人工批准或拒绝；批准后由 `apply_approval()` 真正执行。

---

## 4. 审计系统化（core.py）

新增统一入口，所有关键动作走到这里：

```python
def audit(con, actor, action, detail=None):
    # actor: 'ai:assistant' | 'user:<oim_user_id>' | 'system'
    # action: identify / confirm / reject / assign / notify / approve / dm / memorize
    # detail: dict → json 字符串
```

**必须写入 audit 的动作**：`task_created`（识别落库）、`confirm`、`reject`、`assign_notify`、`approval_pending`、`approval_approved`、`approval_rejected`、`dm_send`、`memorize`。所有 AI 写看板的动作都带 source_msg（溯源）。

---

## 5. API 增量（app.py）

| 接口 | 说明 |
|---|---|
| `POST /api/role/set {oim_user_id, role}` | 管理员设置角色（group_admin 才能调） |
| `GET /api/approvals` | 前端「待审批」区数据源 |
| `POST /api/approvals/{id}/approve|reject` | 人工批复，后调 `apply_approval` |
| `GET /api/audit?limit=` | 审计日志查看（关键动作留痕） |

---

## 6. 实施步骤

| Step | 动作 | 验收 |
|---|---|---|
| S1 | 建 `role`/`approval` 表；写 `init_db` 迁移 | 表存在 |
| S2 | 实现 `get_role`/`can_do`/`require_approval`/`apply_approval`/`audit` | 单测可调 |
| S3 | 把 `confirm/reject/assign_notify` 等走 `audit` | 动作全留痕 |
| S4 | AI 高风险动作改走 `approval`（pending）而非直接执行 | 待审批出现 |
| S5 | app.py 加 role/approvals/audit 接口 + 前端「待审批」区 | 界面可批复 |
| S6 | 被 @ 拒绝派发 → `reject_assign` 进 audit + task.rejected 回传 | 上诉通道通 |

---

## 7. 范围裁剪（MVP）

- ✅ 做：角色判定、高风险审批、审计系统化、被 @ 者上诉
- ❌ 不做：组织架构图谱、细粒度资源级权限、多级审批流、权限 API 对外暴露鉴权（内部用）
- ⏳ 接受：`member` 与 `group_admin` 用一张表区分；imAdmin 硬编码为 admin（后续可迁移到 role 表）

---

## 8. 实施记录（2026-08-23 已完成并验证）

| Step | 状态 | 验证 |
|---|---|---|
| S1 建 role/approval 表 | ✅ | init_db 建成，PRAGMA 确认字段 |
| S2 核心函数 | ✅ | get_role/can_do/set_role/require_approval/list_approvals/decide_approval/audit 单测通过 |
| S3 审计系统化 | ✅ | confirm/reject/identify_ambiguous/task_created 均走 audit() |
| S4 AI 高风险走审批 | ✅ | /api/notify/request 落 pending，不直接发 |
| S5 接口 | ✅ | /api/role/set|get、/api/approvals、/api/approvals/{id}/decide、/api/audit 实测通过 |
| S6 上诉回传 | ✅ | reject 携 reason 走 audit(user, reject) 形成修正信号 |

**实测关键结果**：
- user001=member，user003 可设 group_admin，imAdmin 硬编码 admin
- AI 主动群通知 → `direct:false, approvalId, status:pending`；批准后 `decided_by:group_admin` 并真实代发
- imAdmin 主动群通知 → `direct:true`（管理员直发）
- audit 全留痕：`approval_pending`→`approval_approved`→`set_role`→`reject`

> 注：S4 只对「主动单向外发（群通知/广播/删除）」走审批；**对话内响应的确认卡（send_private_confirm）保持直接发送**，不阻断 M1 核心闭环。
