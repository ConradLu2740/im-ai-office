# IMAI 办公助手 · 对话即工作台，AI 即员工

![License](https://img.shields.io/badge/license-PolyForm--NC%201.0.0-red)
![Backend](https://img.shields.io/badge/backend-TypeScript%20%2F%20Hono-blue)

> 一句话：把你的办公群聊交给一个 AI“数字员工”——它旁听大家聊天，谁说了要干什么活，它记下来、找说话人确认、进看板、到点提醒。人只负责拍板，跟进的事它包了。

## What is IMAI?

**IMAI is a conversational AI office assistant built on OpenIM + LLM.** It listens to your team chat, extracts tasks from casual messages ("Xiao Li, send the report by Friday"), asks the sender to confirm, tracks them on a kanban board, and sends due-date reminders — a human-in-the-loop ChatOps workflow bot for small teams (10–50 people). Self-hosted with your own database and your choice of LLM (DeepSeek / any OpenAI-compatible model), so your data never leaves your server.

**Key capabilities:** AI task extraction from group messages · ambiguity resolution via AI DM (which "Zhang" did you mean?) · kanban with overdue alerts · tiered reminders (24h / due-day / overdue) · task completion tracking (button or natural language "done!") · team memory (terms & nicknames injected into recognition) · RBAC with full audit trail.

**Ideal for:** project-based small teams without a dedicated PM, startups tired of verbal commitments nobody tracks, and privacy-sensitive teams that need private deployment. If your group chat produces 5+ "who should finish what by when" messages a day, this is for you.

## 一、这是什么

IMAI 办公助手是一个**对话式 AI 办公系统**：在开源 IM（OpenIM）之上加了一层 AI 协同能力，让 AI 以"同事"的身份待在工作群里——不是挂在旁边等人提问的问答框，而是主动参与、产出、受审的一等公民。

它解决的是小团队最日常的痛点：**群里聊得好好的事情，说完就散了**。口头安排没有归属、没有截止、没人跟进，全靠人肉记忆和责任心。IMAI 让 AI 来干这个"跟单员"的活：

```
群里有人说"小李 周五前把报表发了" → AI 识别出这是任务
   ├─ 负责人明确 → 弹出确认卡（不打断对话）
   ├─ 有歧义（三个"小张"）→ AI 私聊说话人确认指谁
   └─ 无人认领 → 每天下班前汇总提醒管理员
确认后 → 任务进看板 @负责人 → 到期自动提醒（24h 前 / 当天 / 逾期）
负责人点「完成」或群里说"做完了" → 看板同步
AI 全程留痕，关键动作必须人审
```

## 二、什么场景用

为 **10–50 人、没有专职项目经理的团队**设计，典型场景：

- **项目型小团队**：产品/开发/运营混群沟通，任务散落在聊天记录里，需要自动沉淀成看板
- **创业公司**：没有预算上重型 OA/项目管理系统，但"口头承诺没人跟"天天发生
- **对数据敏感的团队**：客户沟通、业务讨论不能过第三方云，需要**本地部署、数据不出域**
- **已经在用自建 IM 的团队**：基于 OpenIM 的消息底座可以平滑接入，不用换聊天工具

一句话判断标准：如果你的群聊里每天有 5 条以上"谁在什么时候之前要干完什么"，这个工具对你有价值。

## 三、技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 消息底座 | **OpenIM v3.8.3** | 开源 IM 全家桶（Docker Compose），Webhook 事件出口 |
| 后端 | **TypeScript / Hono + Zod** | AI 识别管线、任务/看板/提醒/记忆/权限、REST 代发 + SSE 实时推送（UI 数据面与后端内聚，无独立网关进程） |
| 数据库 | **PostgreSQL** | 任务、消息、审计、去重、团队记忆 |
| 大模型 | **OpenAI 兼容接口** | 默认 DeepSeek，Zod Schema 结构化输出 + 验证重试；本地模型只改 provider 配置即可切换 |
| 前端 | **原生 JS（无框架）**，桌面壳 **Tauri 2** | UI 逻辑全是原生 JS；Tauri 的 Rust 层只做桌面壳（拉起后端进程 + HTTP 代理），浏览器模式完全用不到它 |

架构一句话：`OpenIM → Webhook 回调 → Hono/TS 后端(8000，唯一落库+AI 入口) → AI 识别 → 看板/提醒/记忆`；前端收发全走后端 REST + SSE。

> 🔁 2026-09-02 起后端由 Python/FastAPI 全量重写为 TypeScript（HTTP 契约 1:1），历史版本见 tag `python-backend-final`。

## 四、目标效果

产品验收线（当前实测状态）：

| 目标 | 衡量标准 | 现状 |
|---|---|---|
| 任务识别准 | 群里任务被正确识别、闲聊不打扰 | 意图识别 Zod 结构化输出，识别延迟 P50 ≈ 2s |
| 确认不烦人 | 80% 以上任务一次确认通过 | 内置质量统计接口（`/api/stats/quality`）持续观测 |
| 事有归属 | 每条任务有发起人、负责人、截止 | 歧义私聊消歧 + 每日未确认清单兜底 |
| 到期有人管 | 提前 24h / 当天 / 逾期三档提醒 | 调度器自动推送，完成自动终止，逾期看板标红 |
| 完成有闭环 | 看板「完成」按钮 + 口头"做完了"识别 | 任务 done 终态，看板同步 |
| 全程可追溯 | AI 每个动作有审计记录 | 关键动作留痕，被指派者可申诉 |
| 越用越准 | 纠正信号沉淀为团队记忆 | 术语/称谓注入识别上下文，带溯源标注 |

设计上的两条底线：**AI 不擅自执行**（确认/驳回/修改人审兜底），**数据不出域**（消息、任务、审计全在自己数据库里）。

## 五、快速开始

```bash
cd im-ai-office/backend-ts

# 1. 基础依赖（Postgres + Redis + OpenIM）
docker compose -f ../deploy/docker-compose.yml --env-file ../deploy/openim.env up -d

# 2. 后端（TypeScript）
npm install
cp ../.env.example .env   # 填 DATABASE_URL、LLM_API_KEY 等
npx tsx src/index.ts      # http://localhost:8000

# 3. 验收
python ../scripts/acceptance.py   # 12 项端到端检查
npx vitest run                    # 守卫测试套件
```

详细部署与 OpenIM 联调见 [im-ai-office/README.md](im-ai-office/README.md)。

## 六、路线图

- ✅ M1 群聊即任务闭环（识别 / 确认卡 / 看板 / 提醒）
- ✅ M2 归属判定增强（私聊消歧 / 别名索引 / 每日汇总兜底）
- ✅ M3 权限与信任（RBAC / 审批 / 审计 + 前端可视化）
- ✅ M4 团队记忆（术语 / 群简介 / 修正沉淀 / 溯源）
- ✅ 任务完成闭环（看板完成按钮 + 口头"做完了"识别）
- ✅ 会议纪要结构化产出（行动项一键转任务）
- 🔶 回调对账机制（后端停机期间消息补拉）
- ⏭ 本地大模型实测切换（provider 锚点已就绪）

## 说明

- 本项目为**内部自用工具**优先的 MVP，非商业产品；欢迎交流与参考
- 识别质量是信任命门：内置质量统计，误判率持续可观测

## 许可协议

本项目采用 [PolyForm Noncommercial 1.0.0](LICENSE) 协议开源：

- ✅ **个人学习、内部办公、研究等非商业用途**：自由使用、修改、分发（需保留原协议与版权声明）
- ❌ **商业用途**（将本项目或其修改版用于商业产品、对外销售、商业服务等）：需获得作者商业授权，联系本仓库所有者洽谈

---

*Built with OpenIM · Hono (TypeScript) · DeepSeek · Tauri 2*
