# 团队记忆 Spec（技术实现）

> 目标：让 AI **越用越准**——把用户每次纠正/驳回/修改沉淀为团队记忆，下次同语境直接命中，不再重复犯错。
> 依据：产品思路文档第 15 节（产品层已定）。本 spec 落地技术实现。
> 日期：2026-08-22

---

## 0. 记忆类型（MVP 做 3 类）

| 类型 | 内容 | 存储 | 举例 |
|---|---|---|---|
| **人/称谓** | 正名/花名/外号/职位/别名 | `person` + `alias`（已建） | 小张→张伟(产品) |
| **术语口径** | 团队特殊缩写/词汇定义 | `term`（已建） | 红字版=红色修订版 |
| **群级背景** | 群一句话简介/上下文 | `grp.intro`（已建） | 产品讨论群=负责X功能评审 |

> 决策日志/向量库/跨群共享 → P2，MVP 不做。

## 1. 数据模型（复用已有表，无需新表）

```sql
person(id, real_name, flower_name, title, group_id)          -- 已建
alias(person_id, name, source)                                 -- 已建
grp(id, name, intro, ai_enabled)                               -- 已建
term(id, grp_id, term, meaning, creator_id, created_at)        -- 已建
audit(actor, action, detail, grp_id, task_id, created_at)      -- 已建（记忆留痕）
```
> 全部复用现有 schema；仅需要 `source`(term 的来源)、修正时更新 `term`/`alias`。

## 2. 修正信号识别（核心，从"用户纠正"提取记忆）

**两种来源**：
1. **确认卡驳回/修改**（board-api /tasks/reject 带 reason）——已有接口
2. **群内纠正消息**（用户在群里 @AI 纠正："不是这样，红字版指..."）——需识别

**识别逻辑**（`memory_capture`）：
```
输入：驳回 reason / 群内纠正消息
→ 判断是否为"修正信号"（含否定/纠正意图：不是/不对/应该/其实是/正确的说法是...）
→ 提取结构化记忆：
   ├ 术语：{term, meaning}           → upsert term
   ├ 人称：{alias→person_id}         → upsert alias
   ├ 截止/内容修正：{taskId, 新值}    → 更新 task
→ 写 audit（谁/何时/改了什么记忆）→ 留痕
```
- **启发式规则 + LLM**（LLM 缺配额时用关键词规则：含"不是/其实/应该叫/指的是"判定）
- **低置信不自动写入**：只提示"是否记入团队记忆？"，人确认后沉淀（防误沉淀）

## 3. 注入策略（AI 调用时拼装）

`build_system_context(grp_id)` → 拼 system 前缀（已有雏形在 ai-agent/intent.py）：
```
[群简介]  <grp.intro>
[术语]    term:meaning; term2:meaning2      ← 当前群 term
[人]      小张=张伟(产品); 娜姐=李娜(运营)    ← 当前群成员别名
```
- **只注入当前群**，控制 token（小团队记忆量小）
- 注入到：意图判定(intent) + 确认卡生成 + 后续 Agent 调用
- 记忆层可缓存（Redis），减少 DB 查询
- **引用溯源**：AI 产出可标注"依据：术语 X（Y 定义）"

## 4. 复用入口

| 入口 | 记什么 | 用在哪 |
|---|---|---|
| board-api reject（带 reason） | 修正负责人/内容/截止 | 更新 task + 沉淀原因 |
| 群内 @AI 纠正消息 | 术语/人称 | 更新 term/alias |
| 群里"是"/确认 | 弱化信号（不沉淀） | 无 |

## 5. 分阶段实施

- **P0（本轮）**：人/别名（已并入）+ `grp.intro` 群简介 + **驳回原因→记忆沉淀** + 注入上下文 + audit 留痕
- **P1**：群内纠正消息识别 + 术语表手动维护 + 引用溯源完善
- **P2**：历史消息自动挖掘术语/称呼、决策日志、跨群共享、向量检索

## 6. 验证标准（跑通 = 全部满足）

- [ ] 建一个群并设 `grp.intro`
- [ ] 用户在群里@AI 纠正一个术语/"不是这样"
- [ ] AI 识别为修正信号 → 沉淀到 `term`（或提示确认）
- [ ] 下次 AI 判定/生成时 system context 注入该术语
- [ ] 修正者 userID + 时间 写入 audit
- [ ] 错误/低置信不自动写入（走确认）

## 7. 依赖与风险

| 项 | 说明 |
|---|---|
| LLM | 修正信号识别理想用 LLM；缺配额时用关键词规则（mock），准确率待验证 |
| 注入 token | 小团队记忆量小，可控；需限制单群术语数量 |
| 防误沉淀 | 低置信必须走"确认"而非自动写入 |
| 与现有代码 | 复用 ai-agent/intent.py 的 build_system_context；board-api reject 需回传修正信号 |

---

*团队记忆 Spec v1 · 2026-08-22 · 待实施*
