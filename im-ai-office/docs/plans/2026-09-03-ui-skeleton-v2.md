# UI 骨架 v2 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 按《UI骨架v2-Spec.md》（含评审修订）把前端从"聊天主体+右侧五 tab"改造为"导航栏+聊天/任务/审批/记忆/汇总/权限/设置多视图"，实现 AI 统一卡片语言、三态规则、双主题，后端补 4 处小改支撑。

**Architecture:** 两段交付。PR1 后端小改（TDD，每项带守卫测试）：task 状态类 SSE 事件、term 接口鉴权、unread 水位缺口修复。PR2 前端：index.html 骨架重写为 CSS 变量 token + 左侧导航 + 视图容器，app.ts 从"单页五 tab"改为"视图化"——现有渲染函数与事件委托全部保留，只挪挂载点；消息去重（_seenMsgIDs）、SSE 重连全量刷新、5s 轮询兜底三大历史雷区逻辑一行不动。

**Tech Stack:** 原生 TS + esbuild（无框架）、Hono SSE、CSS 自定义属性（双主题）、Vitest（后端）。

**Spec:** `docs/specs/UI骨架v2-Spec.md`（含评审修订）；评审报告结论已并入。

**预估:** 3–5 人日。每 Task 结束必须 commit（`Made-with: Proma` trailer）；验收不达标注释停下汇报。

---

## PR1 · 后端小改（Task 1–4）

### Task 1: task 状态类 SSE 事件（支撑确认卡双入口收敛）

**Files:**
- Modify: `backend-ts/src/tasks.ts`（confirmTask / rejectTask / updateTask / completeTask 各补 1 行 fanout）
- Test: `backend-ts/tests/guards.test.ts`（新增 G15）

**Step 1: 写失败测试**

```ts
describe("G15 · task 状态 SSE 事件（双入口收敛）", () => {
  it("confirm/reject/update 后 fanout task_status", async () => {
    const events: string[] = [];
    const { subscribe, unsubscribe } = await import("../src/sse.js");
    const sink = (line: string) => events.push(line);
    subscribe(sink);
    try {
      // 造 confirmed 任务（直插），分别触发三条路径
      const t1 = await one<{ id: string }>("INSERT INTO task(content,creator,status) VALUES('g15a','张伟','pending_confirmation') RETURNING id");
      const t2 = await one<{ id: string }>("INSERT INTO task(content,creator,status) VALUES('g15b','张伟','confirmed') RETURNING id");
      const t3 = await one<{ id: string }>("INSERT INTO task(content,creator,status) VALUES('g15c','张伟','confirmed') RETURNING id");
      await post(`/api/tasks/${t1!.id}/confirm`, {});
      await post(`/api/tasks/${t2!.id}/reject`, { reason: "不需要建任务" });
      await post(`/api/tasks/${t3!.id}`, { method: undefined as never, headers: {} } as never); // 占位，实际用 PATCH fetch
    } finally { unsubscribe(sink); }
  });
});
```

> 注：G15 内 PATCH 用 `request()` 帮助函数（guards.test.ts 已有），断言 `events` 中存在 `"task_status"` 且 payload 含 `taskId` 与新 `status`。三条路径（confirm/reject/update）各断言一次。测试写完先跑，预期 FAIL（无 task_status 事件）。

**Step 2: 跑测试确认失败** — `cd backend-ts && npx vitest run -t "G15"`，预期：断言失败（events 里无 task_status）。

**Step 3: 最小实现** — `src/tasks.ts` 四处补：

```ts
import { fanout } from "./sse.js"; // 文件顶部（若无）
// confirmTask 成功后：
fanout("task_status", { taskId, status: "confirmed" });
// rejectTask 成功后：
fanout("task_status", { taskId, status: "rejected" });
// updateTask（PATCH，改负责人/改期/取消）成功后：
fanout("task_status", { taskId, status: <新状态>, changed: ["assignee"|"deadline"|"action"] });
// completeTask 成功后（routes/tasks.ts:126 已有 task_completed，保留，不重复加）
```

**Step 4: 跑测试确认通过** — `npx vitest run`，预期：19+G15 全 PASS。

**Step 5: Commit** — `feat(api): task 状态类 SSE 事件 task_status（确认/驳回/更新），支撑确认卡双入口收敛`

### Task 2: term PATCH/DELETE 鉴权（成员可纠正、管理员可删）

**Files:**
- Modify: `backend-ts/src/routes/memory.ts:18-33`（PATCH/DELETE 加 requireUser + 角色判定；POST /api/term/add 同样补 requireUser）
- Test: `backend-ts/tests/guards.test.ts`（扩展 G14 或新增断言）

**Step 1: 写失败测试**

```ts
it("term PATCH/DELETE：未登录 401；成员可改不可删；group_admin 可删", async () => {
  // 直插术语 + mkSession("user001")（member）+ admin 会话（role set 为 group_admin）
  // PATCH 无 token → 401；member PATCH → ok；member DELETE → 403；admin DELETE → ok
});
```

**Step 2: 跑测试确认失败**（现在匿名也能删 → DELETE 无 token 返回 ok，断言 401 失败）。

**Step 3: 最小实现** — `memory.ts` 仿照 `messages.ts:15-19` 的 requireUser 模式：

```ts
import { sessionUser } from "../auth.js";
import { getRole } from "../rbac.js";
const requireUser = async (c: Context) => { /* 与 messages.ts 相同实现，或抽到 deps.ts 复用 */ };
// PATCH: const user = await requireUser(c); if (!user) return c.json({ ok:false, error:"unauthorized" }, 401);
//        auditLog actor 改为 user.id（现为 "user"）
// DELETE: 同上，且 if ((await getRole(user.id)) !== "group_admin") return c.json({ ok:false, error:"forbidden" }, 403);
// POST /api/term/add: 补 requireUser
```

**Step 4: 全量测试通过**。**Step 5: Commit** — `feat(api): term 增改删加会话鉴权，删除仅 group_admin（评审 P0-2）`

### Task 3: unread 水位覆盖缺口修复

**Files:**
- Modify: `backend-ts/src/routes/messages.ts:115-122`（unread 查询改为以用户所在群列表 LEFT JOIN user_last_read，未打开过的群 = 全部消息数）

**Step 1: 写失败测试**（G15 内追加 it）：造 group + 2 条消息 + 该用户无 user_last_read 行 → GET /api/messages/unread 应返回该群 unread=2（现状返回空数组，FAIL）。
**Step 2: 确认失败。**
**Step 3: 实现**——查询主表改为 group_member→conv 列表 LEFT JOIN user_last_read（参照 routes/messages.ts 会话列表的群来源查询，保持同一来源避免口径分叉）。
**Step 4: 全量通过。** **Step 5: Commit** — `fix(api): unread 对从未打开的会话返回全量未读（评审 P1-6）`

### Task 4: PR1 回归 + 推送

- `cd backend-ts && npx vitest run` 全绿；`npm run build:backend` 通过
- 同步已安装应用：`cp backend-ts/dist/index.js "C:/Users/13906/AppData/Local/Programs/@imaielectron/resources/backend/dist/index.js"` 并重启后端（杀 8000 进程等壳拉起）
- `git push origin main`
- Commit trailer 均带 `Made-with: Proma`

---

## PR2 · 前端骨架重造（Task 5–12）

> 前端无自动化测试，每个 Task 的验证 = `node build.mjs` 构建通过 + 浏览器手动验证点；最终统一过 §回归清单。改造期间**不动**：`_seenMsgIDs` 去重链路、历史整体重建逻辑、SSE 重连刷新、5s 轮询兜底。

### Task 5: index.html 骨架重写 + design tokens

**Files:** Modify: `frontend-ts/static/index.html`（重写）、`frontend-ts/static/styles.css`（清空模板残留，重写为 tokens + 布局）

- `:root[data-theme=light|dark]` 两套 9 token（bg/panel/border/text/muted/accent/ok/danger/soft）+ `--grad`；深色按评审修正（主按钮纯色、muted #9ba1af、层级靠边框）
- 骨架：`.nav`（64px，SVG 图标：聊天/任务/审批/记忆/汇总/权限/设置，角标容器 `.bdg`）+ `.topbar`（标题/主题切换/用户）+ 四个 `.view` 容器（chat/task/approval+summary+rbac+memory 各自独立 view 容器，id 与旧 tab 一一对应）
- 旧"右侧面板"DOM 不删，整体挪入对应 `.view` 容器（保证 app.ts 现有 getElementById 全部仍然命中——**这是回归安全的锚**）
- 验证：build 通过；打开页面无 JS 错误（window.onerror 红条无内容）；旧功能元素全部存在于 DOM

### Task 6: 主题系统

- 顶栏按钮三态循环：跟随系统 → 浅 → 深；`localStorage.imai_theme`；初始 `prefers-color-scheme`
- 验证：三态切换各视图无对比度硬伤；刷新记忆生效

### Task 7: 聊天视图迁移

- 会话列表 + 消息流 + 输入框 + AI 置顶会话 + 确认卡（AI 助手会话内）原逻辑挪入 `#view-chat`
- 聊天头部工作态提示：发送后至响应前显示"AI 正在旁听…"（本地状态，不发请求）
- 确认卡操作后：SSE `task_status` 到达 → 若本会话有对应卡片则原地变灰留痕（`data-task-id` 匹配）
- 验证：发消息/历史/去重/确认流人工过一遍

### Task 8: 任务工作台视图（默认关闭，可配默认）

- 横排"需要你处理"：全部 pending_confirmation + 逾期 confirmed（平铺，不按用户过滤——assignee 是显示名字符串，评审 P1-4 降级）
- 看板四列：待指派(pending_assignee) / 待确认(pending_confirmation) / 进行中(confirmed，逾期标签+置顶) / 已完成(done)；rejected/cancelled 不入列
- 卡片操作接 SSE `task_status`：任意入口操作后 `loadTasks()` + 横排重渲染（即时收敛）
- 驳回原因选择器（G14 已有）原样迁移；确认卡"改负责人"接现有 PATCH 编辑逻辑
- 验证：确认/驳回/编辑/逾期标红排序

### Task 9: 审批/汇总/权限/记忆迁移

- 四个视图内容 = 旧 tab DOM 原样挪入 + 新主题
- 记忆页：横幅"团队记忆 · 认识 N 人 · M 条术语"（数据 memory.terms + grp_meta，"上次更新"字段后端暂无则先不显示——不阻塞）；每条术语行内编辑（现有 PATCH）+ 删除按钮仅 group_admin 可见（GET /api/role/:user 判定）；删除"越来越懂你们"类文案
- 汇总页增加"已取消/已驳回"列表区（GET /api/tasks?status=…）
- 验证：四视图功能与旧版一致

### Task 10: 角标系统

- 任务角标 = pending_confirmation + pending_assignee 数（来源 loadTasks 已有数据，SSE task_status/ai.card 后重算）
- 聊天角标 = Σ /api/messages/unread（5s 轮询沿用）+ SSE `message` 事件增量 +1；AI 助手未读合并计入
- 验证：另一端发消息/建任务，角标 5s 内更新

### Task 11: 设置视图 + 默认落地页 + 引导条

- 设置：落地页单选（聊天/任务，默认聊天，localStorage）+ 主题三选
- 首次进入：一次性"新版变化"提示条（localStorage 标记，可关闭）

### Task 12: 回归清单 + 验收 + 交付

逐项人工勾选（历史雷区）：
- [ ] 发送去重：同一条消息只渲染一次（本地回显+SSE 回声+历史重建三路）
- [ ] 历史重建清 _seenMsgIDs 后重建正确
- [ ] SSE 断开重连 → 全量刷新不重复
- [ ] 5s 轮询兜底在 SSE 断开时仍工作
- [ ] confirm/reject/complete/update 四操作双入口收敛 ≤1s
- [ ] 驳回原因选择器可用且审计 reason 正确
- [ ] 深浅主题 × 七视图 无硬伤
- [ ] 踢掉旧 index.html 依赖的 window.IMAI 句柄仍暴露（调试/自动化用）

交付：build 前后端 → 同步已安装应用（dist + web/app.js）→ 真机截图（浅/深 × 聊天/任务/记忆）→ commit + push。

---

## 风险与回退

- 前端大改期间保留旧版可用：PR2 在独立分支 `ui-v2` 开发，真机验收通过后合 main；出问题 `git revert` + 已安装应用 .bak 回滚
- 后端 PR1 每项带守卫测试，独立可回滚
