# B1 任务可修改 + B3 记忆库管理 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 已确认任务支持改负责人/改期（提醒重算）/取消；术语库支持增删改。

**Architecture:** 后端在 `imai/services/tasks.py` 加 `update_task`、`imai/api/routes_tasks.py` 加 PATCH 路由；术语在 `routes_memory.py` 加 PATCH/DELETE；前端 `desktop/src/app.js` 内联编辑 + 两步确认（事件委托），改完同步 `web/app.js`。SQLite/PG 双方言，SQL 只用两者兼容子集。

**Tech Stack:** FastAPI + Pydantic、SQLite（测试）/PG（生产）、原生 JS 前端（CSP 无内联）、pytest。

**Spec:** `迭代2-Spec.md` §1/§2

---

### Task 1: update_task 服务（TDD）

**Files:**
- Test: `tests/guard/test_g6_task_update.py`（新建）
- Modify: `imai/services/tasks.py`

**Step 1: 写失败测试**（复用 `tests/helpers.py` 的 `make_intent`、conftest 的 `client/fake_llm/db` fixture；先造一个 confirmed 任务再改它）

```python
def test_g6_1_update_assignee_and_deadline(client, fake_llm, db):
    # 建任务并确认（同 G1 流程）
    ...
    r = client.patch(f"/api/tasks/{tid}", json={"assignee": "李娜(娜姐)", "deadline": "2026-09-05 18:00"})
    assert r.status_code == 200
    t = r.json()["task"]
    assert t["assignee"] == "李娜(娜姐)" and t["deadline"] == "2026-09-05 18:00"
    assert t["deadline_at"][:16] == "2026-09-05 18:00"
    # audit 留痕
    assert db.query("SELECT COUNT(*) AS n FROM audit WHERE action='task_update'")[0]["n"] >= 2

def test_g6_2_deadline_reset_reminder(client, fake_llm, db):
    # 确认任务 → 手动插 reminder_sent → 改期 → 记录被清
    ...

def test_g6_3_cancel(client, fake_llm, db):
    # action=cancel → status='cancelled'，/api/tasks 不再返回，audit 有记录
    ...

def test_g6_4_errors(client, fake_llm, db):
    # 404 不存在；400 deadline 非法 "abc"；400 空 body 无字段
    ...
```

**Step 2: 跑测试确认失败** — `python -m pytest tests/guard/test_g6_task_update.py -q`，预期 FAIL（405/404，路由不存在）

**Step 3: 实现** — `imai/services/tasks.py` 追加：

```python
CANCELLED = "cancelled"

def update_task(con, task_id, assignee=None, deadline=None, cancel=False):
    from imai.repos import audit_log
    c = con.cursor()
    c.execute("SELECT * FROM task WHERE id=?", (task_id,))
    row = c.fetchone()
    if not row:
        return None, "task_not_found"
    changes = {}
    if assignee is not None and assignee != row["assignee"]:
        c.execute("UPDATE task SET assignee=?, updated_at=datetime('now') WHERE id=?", (assignee, task_id))
        changes["assignee"] = (row["assignee"], assignee)
    if deadline is not None:
        try:
            dt = datetime.strptime(deadline, "%Y-%m-%d %H:%M")
        except ValueError:
            return None, "bad_deadline"
        c.execute("UPDATE task SET deadline=?, deadline_at=?, updated_at=datetime('now') WHERE id=?",
                  (deadline, dt.strftime("%Y-%m-%d %H:%M"), task_id))
        changes["deadline"] = (row["deadline"], deadline)
        c.execute("DELETE FROM reminder_sent WHERE task_id=?", (task_id,))
    if cancel:
        c.execute("UPDATE task SET status='cancelled', updated_at=datetime('now') WHERE id=?", (task_id,))
        changes["status"] = (row["status"], CANCELLED)
    con.commit()
    if not changes:
        return None, "no_changes"
    for field, (old, new) in changes.items():
        audit_log(con, "user", "task_update",
                  {"taskId": task_id, "field": field, "old": old, "new": new})
        if field == "deadline":
            audit_log(con, "user", "reminder_reset", {"taskId": task_id})
    c.execute("SELECT * FROM task WHERE id=?", (task_id,))
    return c.fetchone(), None
```

（文件头补 `from datetime import datetime`；`reject_task` 保留原样）

**Step 4: 跑测试** — 先只实现服务，路由还没加时 G6 仍失败属预期，直接进 Task 2 后一起验证。若想单测服务层，可 `db` fixture 直调 `update_task` 断言。

**Step 5: Commit** — `git add -A && git commit -m "feat: update_task 服务（改负责人/改期重置提醒/取消）"`

### Task 2: PATCH 路由

**Files:**
- Modify: `imai/api/routes_tasks.py`

**Step 1:** 加模型与路由：

```python
class TaskUpdateIn(BaseModel):
    assignee: Optional[str] = None
    deadline: Optional[str] = None
    action: Optional[str] = None  # "cancel"

@router.patch("/api/tasks/{task_id}")
def task_update(task_id: int, body: TaskUpdateIn):
    from imai.services.tasks import update_task
    if body.action not in (None, "cancel"):
        from fastapi import HTTPException
        raise HTTPException(400, "action 仅支持 cancel")
    con = get_conn()
    try:
        row, err = update_task(con, task_id, assignee=body.assignee,
                               deadline=body.deadline, cancel=(body.action == "cancel"))
        if err == "task_not_found":
            raise HTTPException(404, "任务不存在")
        if err == "bad_deadline":
            raise HTTPException(400, "deadline 格式需为 YYYY-MM-DD HH:MM")
        if err == "no_changes":
            raise HTTPException(400, "没有任何变更字段")
        from imai.repos import get_task_dict
        return {"ok": True, "task": get_task_dict(con, task_id)}
    finally:
        con.close()
```

**Step 2:** `python -m pytest tests/guard/test_g6_task_update.py -q` → 4 passed（Task 1 的测试此刻全绿）

**Step 3:** `python -m pytest tests/ -q` → 存量无回归

**Step 4: Commit** — `feat: PATCH /api/tasks/{id}（任务修改入口）`

### Task 3: B1 前端（编辑/取消）

**Files:**
- Modify: `desktop/src/app.js`（renderTaskCard / 新函数 / _dispatchAction）

**Step 1:** `renderTaskCard` 的 confirmed 分支加按钮；`editingTaskId` 全局变量渲染内联表单：

```js
let editingTaskId = null;
// 卡片尾部（!isPending && t.status==="confirmed"）：
//   <button data-action="editTask" data-task-id>编辑</button>
//   <button class="danger" data-action="cancelTask" data-task-id>取消任务</button>
// editingTaskId === t.id 时渲染表单：
//   <input id="editAssignee" value="${escAttr(t.assignee||"")}">
//   <input id="editDeadline" type="datetime-local" value="${(t.deadline_at||"").slice(0,16).replace(" ","T")}">
//   <button data-action="saveTaskEdit" data-task-id>保存</button>
//   <button data-action="abortEdit">放弃</button>
```

**Step 2:** 新函数 + dispatch case：

```js
async function saveTaskEdit(id) {
  const assignee = document.getElementById("editAssignee").value.trim();
  const dl = document.getElementById("editDeadline").value; // "YYYY-MM-DDTHH:MM"
  const body = {};
  if (assignee) body.assignee = assignee;
  if (dl) body.deadline = dl.replace("T", " ");
  await api(`/api/tasks/${id}`, { method: "PATCH", headers: {...}, body: JSON.stringify(body) });
  editingTaskId = null; loadTasks(); showToast("任务已更新", true);
}
async function cancelTask(id, btn) {
  if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "确认取消?"; setTimeout(()=>{btn.dataset.armed="";btn.textContent="取消任务";},3000); return; }
  await api(`/api/tasks/${id}`, { method: "PATCH", ..., body: JSON.stringify({action:"cancel"}) });
  loadTasks(); showToast("任务已取消", true);
}
```
_dispatchAction 加：`case "editTask": editingTaskId=Number(d.taskId); loadTasks(); break;`、`saveTaskEdit`、`abortEdit`（editingTaskId=null; loadTasks()）、`cancelTask` 传 `el`。

**Step 3:** `cp desktop/src/app.js web/app.js`

**Step 4: Commit** — `feat: 看板任务编辑/取消 UI（内联表单+两步确认）`

### Task 4: B3 术语增删改（TDD）

**Files:**
- Test: `tests/guard/test_g4_memory.py`（追加用例）
- Modify: `imai/api/routes_memory.py`

**Step 1: 失败测试**：改释义后 `GET /api/memory` 值更新且 proofs 反映新值；删除后列表不含、再删返回 404；非法空 meaning 400。

**Step 2:** 实现：

```python
@router.patch("/api/term/{term}")
def term_update(term: str, body: TermIn):   # 只用 body.meaning
    if not body.meaning.strip(): raise HTTPException(400, "meaning 不能为空")
    # UPDATE term SET meaning=? WHERE term=?；rowcount==0 → 404；audit term_update
@router.delete("/api/term/{term}")
def term_delete(term: str):
    # DELETE FROM term WHERE term=?；rowcount==0 → 404；audit term_delete
```

**Step 3:** `python -m pytest tests/guard/test_g4_memory.py -q` → 全绿

**Step 4: Commit** — `feat: 术语修改/删除端点`

### Task 5: B3 前端（记忆页管理）

**Files:**
- Modify: `desktop/src/app.js`（loadMemory 渲染 + 新函数 + dispatch）

**Step 1:** 术语行加 ✎（行内替换成文本框+保存）/ 🗑（两步确认，同 cancelTask 模式）；面板顶部新增表单（term/meaning 输入 + 添加按钮，调 `/api/term/add` 后 `loadMemory()`）。

**Step 2:** `cp desktop/src/app.js web/app.js`

**Step 3: Commit** — `feat: 记忆页术语增删改 UI`

### Task 6: 回归 + 文档收尾

**Step 1:** `python -m pytest tests/ -q` → 全绿（存量 79 + 新增）
**Step 2:** `python scripts/acceptance.py` → 12 项通过
**Step 3:** 交接文档「已知问题与待办」追加迭代 2 记录、更新版本状态；`迭代2-Spec.md` 勾验收项
**Step 4: Commit** — `docs: 迭代2 B1+B3 收官更新`

---

**B2（会议纪要）** 不在本计划内：B1/B3 收官后单独立 Spec/Plan。
