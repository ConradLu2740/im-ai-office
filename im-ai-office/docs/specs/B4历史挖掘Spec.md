# B4 历史消息挖掘 Spec（迭代 3）

时间：2026-08-31 ｜ 前置：迭代2 B1/B2/B3 收官、识别质量统计上线 ｜ 来源：迭代2-候选对比 B4（当时决定"视情况并入记忆主题"）

## 1. 目标

把群里**历史聊天**批量扫一遍，提取三类候选 —— **术语 / 称呼（别名）/ 遗漏任务** —— 全部进**待人工确认池**，用户逐条接受后才真正入库。解决两件事：

1. 识别冷启动质量：真用之前先把术语/称呼喂进团队记忆（M2"人/别名表外接待补"的遗留一并收掉）；
2. 历史遗漏任务：上线前的口头安排补进看板确认流。

## 2. 范围与不做

**做**：
- 数据源：本地 `message` 表（网关已同步），按 `conv_id` 取最近 N 条，**分批**（默认 100 条/批）喂 LLM；
- 三类候选统一入新表 `mine_candidate`（staging），**绝不直接写** term/alias/task；
- 接受/拒绝两端点 + 审计；接受 term → `source='mined'`；接受别名 → 解析/创建 person + `insert_alias_if_absent`；接受任务 → `status='pending_confirmation'` 走看板正常确认流（复用 `minutes_to_task` 同款语义）；
- 前端「记忆」页加挖掘区：选会话 → 跑挖掘 → 待确认列表逐条 接受/拒绝；desktop/src 与 web/ 同步。

**不做**（防跑偏）：
- ❌ 挖掘过程触发确认卡/私聊/提醒（与实时 pipeline 的本质区别：只产候选，无任何外发副作用）；
- ❌ 不复用 process_message 逐条跑（会烧 LLM 且带副作用）；用一次 json_mode 批量提取（同 B2 minutes 模式）；
- ❌ 不做全库自动入库、不做置信度自动放行（与产品铁律"AI 不擅自执行"一致）；
- ❌ 不拉 OpenIM 云端历史（本地 message 表有多少挖多少，拉云端历史另立 Spec）。

## 3. 数据模型（双方言，对齐 minutes 表写法）

```sql
CREATE TABLE IF NOT EXISTS mine_candidate(
  id BIGSERIAL PRIMARY KEY,
  conv_id TEXT,
  kind TEXT,            -- 'term' | 'alias' | 'task'
  payload TEXT,         -- JSON TEXT：term:{term,meaning} alias:{real_name,alias} task:{content,assignee_hint,deadline_hint}
  evidence TEXT,        -- 原文摘录（溯源，≤120 字）
  msg_count INTEGER,    -- 本批消息数
  status TEXT DEFAULT 'pending',  -- pending|accepted|rejected|duplicate
  created_at TIMESTAMPTZ DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by TEXT
);
```

## 4. 接口

| 端点 | 说明 |
|---|---|
| `POST /api/mine/run` `{conv_id, limit≤2000, batch=100}` | 分批提取 → 落候选池，返回 `{ok, run_id?无, total, by_kind, candidates}`；会话无消息 → 400 |
| `GET /api/mine/candidates?status=pending&kind=` | 候选列表（payload 反序列化为对象） |
| `POST /api/mine/candidates/{id}/decide` `{action: accept\|reject}` | accept 按 kind 分发入库（见 §2），candidate 置 accepted + decided_by='user' + audit `mine_accepted`；reject 置 rejected + audit `mine_rejected` |

**去重**：
- 提取时：term 已存在（同名词完全匹配）→ 候选直接置 `duplicate` 不进 pending；alias 同 real_name+alias 已存在 → 同上；任务不查重（历史遗漏天然和现有任务不同）。
- 接受时：term 冲突走 `add_term` 既有 ON CONFLICT 覆盖语义；alias 幂等；重复 decide（非 pending）→ 400。

## 5. LLM 约定

- 系统提示对齐 MINUTES_SYSTEM 风格：输入按时间排列的群聊片段，输出 JSON
  `{"terms":[{term,meaning}],"aliases":[{real_name,alias}],"tasks":[{content,assignee_hint,deadline_hint}],"evidence":{...}}`；
  强调"只提取聊天记录里真实出现的，不编造"；
- 每批 transcript 前带批次序号，LLM 单独调用；一批失败（bad_llm）跳过该批并在结果里计数，**不中断整体**；
- LLM 调用必须经 `imai/llm.py::get_llm()` 锚点（DX D3 契约，测试 patch `llm._impl`）。

## 6. 验收标准

- [ ] 造 10 条含"上线=发布到生产"术语、"娜姐=李娜"称呼、1 条明确任务安排的种子消息 → POST run → 三类候选各就位，term/alias/task 表**零变化**
- [ ] 重复术语第二批被置 duplicate；GET candidates?status=pending 不含 duplicate
- [ ] accept term 候选 → term 表新增且 source='mined' + audit；accept alias → person 创建/复用 + alias 落库；accept task → 任务 pending_confirmation 可在看板确认
- [ ] reject 候选 → status=rejected，audit 留痕；对已决候选再 decide → 400
- [ ] 前端记忆页可跑挖掘/列表/接受/拒绝，desktop 与 web 同步（浏览器预览验证）
- [ ] guard 全绿 + 全量 pytest 无回归 + acceptance 12/12
