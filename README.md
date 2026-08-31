# IMAI 办公助手 · 对话即工作台，AI 即员工

> 让 AI 以"同事"的身份待在办公群里：旁听对话、识别任务、人事确认、看板跟进、到期提醒——把群里"嘴上说的事"变成"有人负责、有人跟进"的正式任务。

![Status](https://img.shields.io/badge/status-MVP跑通-brightgreen) ![Stack](https://img.shields.io/badge/stack-OpenIM%20%2B%20FastAPI%20%2B%20LLM-blue) ![部署](https://img.shields.io/badge/部署-本地%2F私有化-orange)

## 这是什么

一个**对话式 AI 办公**的最小可用产品（MVP）：基于开源 IM（OpenIM）+ 大模型，AI 作为群聊里的一等公民参与协作——而不是挂在旁边的问答框。

核心闭环只有一件事：**群聊即任务**。

```
群里有人说安排 → AI 实时识别
   ├─ 负责人明确 → 弹确认卡（不打断对话）
   ├─ 有歧义   → AI 私聊发送者确认"哪个小张"
   └─ 无人认领 → 每日下班前汇总提醒管理员
确认后 → 任务进看板 @负责人 → 到期自动提醒（24h 前 / 当天 / 逾期）
负责人回"完成" → 看板同步
AI 全程留痕，关键动作人审
```

## 核心特性

- **实时任务识别**：AI 逐条判定群消息是否为任务安排，提取内容 / 负责人 / 截止 / 置信度（高置信才打扰，中低置信静默进疑似列表）
- **人审确认**：确认 / 驳回 / 修改三件套，AI 不擅自执行；被指派者可申诉
- **归属消歧**：人表 + 别名索引，多个"小张"时 AI 私聊发送者确认，不瞎猜
- **看板与提醒**：待确认 / 已确认 / 待指派三栏看板，逾期自动标红，双档到期提醒，每日未确认清单定时汇总给管理员
- **团队记忆**：术语口径（"红字版"是什么意思）+ 人称号谓注入识别上下文，用户每次纠正都会沉淀，越用越准
- **权限与审计**：RBAC 角色，高风险动作审批，AI 关键动作全留痕可追溯
- **数据自主**：本地 / 私有化部署，LLM 可切换云端或本地模型（只改 provider 配置）

## 架构

```
OpenIM(消息层/Webhook) ──► 消息网关(Node, 8400) ──► 后端(FastAPI, 8000)
                                                      ├─ AI 识别管线（意图→归属→落库）
                                                      ├─ 看板/确认/提醒/记忆/审批
                                                      └─ PostgreSQL / SQLite + Redis
桌面端（Tauri）/ 浏览器 ──── 同源反代 ────────────────┘
```

- **消息层**：OpenIM v3.8.3（Docker Compose 全家桶），回调 + SDK 网关双通道接入
- **AI 层**：OpenAI 兼容接口，DeepSeek / 本地模型可切换；识别延迟 P50 ≈ 2s
- **可靠性**：clientMsgID 全链路幂等去重、确定性 msgId 防重放、事件去重窗口
- **测试**：pytest 分层套件（guard / async / pg / remind / eval）+ 一键验收脚本

## 快速开始

```bash
cd im-ai-office

# 1. 基础依赖（Postgres + Redis + OpenIM）
docker compose -f deploy/docker-compose.yml --env-file deploy/openim.env up -d

# 2. 后端
pip install -r requirements.txt
cp .env.example .env   # 填 LLM_API_KEY 等
python app.py          # http://localhost:8000

# 3. 消息网关
node desktop/src/msg_gateway.bundle.cjs

# 4. 验收
python scripts/acceptance.py   # 12 项端到端检查
python -m pytest tests/ -q     # 回归套件
```

详细部署与联调见 [im-ai-office/README.md](im-ai-office/README.md)。

## 目录结构

```
im-ai-office/
├── app.py               # 后端入口（FastAPI，同源挂 Web 静态 + /gw 网关反代）
├── imai/                # 核心包：识别管线 / 任务 / 提醒 / 记忆 / RBAC / 网关回调
├── desktop/             # Tauri 桌面壳 + 消息网关（Node）+ 前端源
├── web/                 # 浏览器模式前端（后端同源服务）
├── deploy/              # Docker Compose 全家桶
├── docs/specs/          # 迭代设计 Spec 与决策记录
└── tests/               # 分层回归测试
```

## 路线图

- ✅ M1 群聊即任务闭环（识别 / 确认卡 / 看板 / 提醒）
- ✅ M2 归属判定增强（私聊消歧 / 别名索引 / 每日汇总兜底）
- ✅ M4 团队记忆（术语 / 群简介 / 修正沉淀 / 溯源）
- 🔶 M3 权限与信任（RBAC / 审批 / 审计已落地，前端可视化进行中）
- ⏭ 会议纪要结构化产出、任务完成回写、本地大模型实测

## 说明

- 本项目为**内部自用工具**优先的 MVP，非商业产品；欢迎交流与参考
- 数据不出域：消息、任务、审计全部落在自己的数据库里
- 识别质量是信任命门：内置意图识别 eval 样本集与质量统计接口（`/api/stats/quality`）

---

*Built with OpenIM · FastAPI · DeepSeek · Tauri*
