# IMAI 桌面应用 · 测试 Spec

> 目的：验证 IMAI 办公助手桌面应用的关键用户流程是否可用。
> 方法：浏览器预览 + 截图识别界面元素 + `cli.py` 驱动后端/网关链路；真实 Tauri 桌面走 `invoke` 路由，preview 走 fetch，二者核心链路一致。
> 时间：2026-08-23。OpenIM 3.8.3（Colima VM），后端 8000，网关 8400。

---

## 0. 前置条件

| 项 | 要求 | 检查方式 |
|---|---|---|
| 后端 | 运行中(:8000) | `curl http://127.0.0.1:8000/api/tasks` |
| 网关 | 运行中(:8400) | `curl http://127.0.0.1:8400/gw/ping` |
| OpenIM | 运行中(Colima VM) | `ssh -S ~/.colima/_lima/colima/ssh.sock limactl@127.0.0.1 docker ps` |
| 登录账号 | 普通用户 user001/002/003（**勿用 imAdmin**） | —— |

一键拉起：`cd im-ai-office && python3 cli.py up`
> `cli.py` 由 Agent 新增（复刻 Tauri 编排层），能无 GUI 驱动整条链路。

---

## 1. 测试矩阵

| 用例 | 场景 | 预期 | 步骤 | 实测 |
|---|---|---|---|---|
| **T1** | 登录页渲染 | user001 默认填充、常用账号下拉、imAdmin 提示 | 打开应用 | ✅ 截图识别通过 |
| **T2** | 登录进主界面 | 会话列表 + 任务看板渲染 | 登录 user001 | ✅ 进入主界面 |
| **T3** | 模拟群消息 → AI 识别落库 | 待确认列新增任务卡片 | 发模拟消息 | ✅ `action=task_created` |
| **T4** | 人审确认任务 | 任务从待确认流转到已确认 | 点「确认」 | ✅ 计数 +1 |
| **T5** | AI 识别准确性 | 意图/负责人/截止时间正确 | 触发模拟消息 | ✅ 识别自认领无歧义 |

> 2026-08-23 执行：`python3 test_flow.py` → **PASS 14 / FAIL 0**（T3/T4/T5 共 14 项断言全过）；T1/T2 用截图识别通过。

---

## 2. 用例详情

### T1 登录页渲染
**前置**：无。
**步骤**：打开桌面应用。
**预期**：
- 用户ID框默认 `user001`
- 常用账号下拉含 `user001·李娜 / user002·张敏 / user003·张伟 / 自定义`
- 提示「imAdmin 是管理账号，不能登录」
**实测**：✅ 截图确认全部元素。

### T2 登录进主界面
**前置**：后端/网关/OpenIM 就绪。
**步骤**：选 user001 → 点登录。
**预期**：进入主应用，会话列表显示 AI 助手（红点）、群 498161590、imAdmin、user001；右侧任务看板列「待指派/待确认/已确认」。
**实测**：✅ 后端 `/openim/login` 200，主界面渲染正常。
> ⚠️ preview 环境顶部会报「网关登录异常 HTTP 404」：因 preview 无 Tauri `api_call` 的 `/gw/`→8400 路由，走到 8000 故 404。**真实桌面走 invoke，无此问题**（已用 CLI 模拟 invoke 路由验证 `/gw/login`→8400 成功）。

### T3 模拟群消息 → AI 识别落库
**前置**：已登录。
**步骤**：点「🛠 模拟群消息」→ 填发言人/内容 → 发送。或调 `POST /api/simulate_message {sender,text}`。
**预期**：后端 `action:task_created`，看板「待确认」列新增任务卡片。
**实测**：✅ 发「这次618复盘我来出物料清单，下周三前」→ AI 返回 `task_created`(taskId 8)，看板待确认 0→1。

### T4 人审确认任务
**前置**：有待确认任务。
**步骤**：点任务卡片「确认」。
**预期**：任务从「待确认」移到「已确认」，计数变化。
**实测**：✅ `/api/tasks/8/confirm` 200，待确认 1→0，已确认 2→3。

### T5 AI 识别准确性（补充）
**步骤**：模拟消息含负责人/期限。
**预期**：识别出 `assignee`、`deadline`、`assign_mode=self`（无歧义）、`intent.is_task=true`。
**实测**：✅ 后端返回 `{assignee:王冰, deadline:下周三前, mode:self, is_task:true, status:pending_confirmation}`。

---

## 3. 接口清单（用于自动化测试）

| 动作 | 接口 | 关键 |
|---|---|---|
| 登录换 token | `POST /openim/login {user_id}` | 用户须存在；user001 可，imAdmin 不可 |
| 模拟群消息 | `POST /api/simulate_message {sender,text,conv_id}` | 触发 AI 识别+落库 |
| 任务列表 | `GET /api/tasks?status=` | 看板数据源 |
| 确认/驳回 | `POST /api/tasks/{id}/confirm|reject` | 人审流转 |
| 网关登录 | `POST /gw/login {userID,token}` | 连接 OpenIM WS，桌面端经 invoke 路由到 8400 |

---

## 4. 已知说明

- **预览 vs 桌面差异**：浏览器 preview 里 `/gw/*`(SDK 实时收发) 不可用（无 Tauri 路由），但登录+看板+任务闭环不受影响；桌面 app 完整可用。
- **imAdmin 限制**：imAdmin 是 OpenIM admin 平台账号，不能换登录 token，仅作发消息代发身份（`.env` 的 `OPENIM_SENDER_ID`）。
- **自动化入口**：`python3 cli.py chain --user user001` 可无 GUI 驱动 login→conversations→send→poll。

---

## 5. 回归建议
每次改动前端/后端后，跑 T3（模拟消息→看板新增）作为最小回归，即可确认 AI 闭环未被破坏。

## 6. 自动化脚本
`python3 test_flow.py` —— 带断言跑 T3/T4/T5（返回码 0=全过，1=有失败）：
```bash
python3 test_flow.py --dry-run   # 只看环境与连通性，不改数据
python3 test_flow.py             # 新增一条测试任务并确认，断言后输出 PASS/FAIL
```
注意：跑 `test_flow.py` 会真实落库一条任务（发给 OpenIM group 之外走 `/api/simulate_message`），适合回归验证。
