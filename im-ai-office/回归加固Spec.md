# IMAI · 回归加固 Spec（Step 0）

> 时间：2026-08-26 ｜ **执行完成：2026-08-27**（guard 26 断言全绿×3 ≤0.2s；Eval 首轮基线 19/20）｜ 关联：《架构分析报告.md》§3.0 Step 0 ｜ 前置：git 基线 `v0-baseline` 已建立（fc44aa0）
> 目的：为 Step 1（拆层重构）建立**自动化安全网**——任何一次改动后能立刻知道"对外行为有没有变"；同时建立意图判定**误判样本集**，作为 AI 质量基线。

---

## 1. 背景：为什么现有测试不够

| 现状 | 问题 |
|---|---|
| 《测试Spec.md》T1–T5 | T1/T2 为截图人工验证；自动化仅 `test_flow.py` 覆盖 T3/T4/T5 共 14 断言 |
| `test_flow.py` 强依赖真实环境 | 需同时拉起 后端(:8000)+网关(:8400)+OpenIM(Colima)，且打真实 LLM API（单次全跑约数十秒+token 费用）——不适合作为重构期间的高频回归 |
| 未覆盖的核心链路 | RBAC 角色/审批、记忆注入与修正沉淀、私聊消歧、每日汇总、AI DM、审计留痕 |
| 会写脏数据 | 直接落在 `imai.db` 主库，多次运行互相污染 |

**结论**：需要两条互不依赖的测试轨道——「结构守卫」管重构安全，「样本评测」管 AI 质量。

## 2. 测试分层设计

```text
┌──────────────────────────────────────────────────────┐
│ Guard 层（重构安全网）                                  │
│  mock LLM 固定响应 + 临时 SQLite 库 + FastAPI TestClient│
│  断言对象：API 响应结构 + 业务状态机流转                  │
│  要求：零外部依赖（不需要 OpenIM/网关/网络）、<30s、可反复跑 │
├──────────────────────────────────────────────────────┤
│ Eval 层（意图判定样本集）                                │
│  真实 LLM（走 .env provider）                           │
│  断言对象：is_task / mode / assignee / deadline / 歧义    │
│  要求：输出命中率报表；改 AI prompt 或换模型时必跑          │
├──────────────────────────────────────────────────────┤
│ E2E 层（存量保留）                                       │
│  test_flow.py 原样保留，仅作发版前最终验证                 │
└──────────────────────────────────────────────────────┘
```

**为什么 mock LLM 对 Guard 层成立**：Step 1 重构目标是"搬代码不改逻辑"，`intent_detect` 的输出在固定输入+固定 LLM 响应下必须逐字段一致——mock 正是为了把"我们的代码"和"模型抖动"解耦。模型质量归 Eval 层管。

## 3. 数据与环境隔离（关键实现约束）

1. **库隔离**：所有测试强制使用临时库。`core.get_conn/init_db` 已支持 `db_file` 参数，conftest 中统一通过环境变量 `IMAI_DB=<tmpdir>/test.db`（import core 前设置）注入，绝不允许碰 `imai.db`。
2. **LLM 隔离**：Guard 层用 pytest `monkeypatch` 替换 `core.llm_chat`，返回预设 JSON。按用例给出不同的固定 intent 输出，从而驱动不同分支（确认卡/私聊消歧/疑似列表/静默）。
3. **网关副作用（执行结论：无需改动生产代码）**：侦察确认 `_gateway_auto_login` 为 daemon 线程且全兑底 try/except，网关不可达仅打日志不阻塞 startup——原计划的 `GATEWAY_AUTOSTART=0` 开关**取消**，实现零侵入。另：conftest 在 import core 前显式 load_dotenv（core 的 LLM_* 常量在 import 时冻结，否则 Eval 层真实调用拿不到 key，实测踩坑已修）。
4. **HTTP 入口**：Guard 层用 `fastapi.testclient.TestClient` 直连 ASGI app，不起端口、不走 8400。

## 4. Guard 层用例清单（全部断言现有响应结构，不改预期值）

### G1 任务全生命周期（`/api/*`，对应 task 状态机）
| # | 步骤 | 断言 |
|---|---|---|
| G1.1 | simulate_message 发明确认领话术（mock intent: is_task/self/下周三） | resp.ok=true；action=task_created；task.status=pending_confirmation；含 taskId/content/deadline |
| G1.2 | GET /api/tasks | 新任务可见；字段集合与重构前基线一致（快照对比） |
| G1.3 | POST /api/tasks/{id}/confirm | status 变 confirmed |
| G1.4 | POST /api/tasks/{id}/reject body={reason:"不是任务"} | status=rejected；audit 新增一条 reject 动作；产生修正信号记录 |
| G1.5 | 同一消息内容重复投递 2 次 | 至少不产生两张相同 source 内容的 pending 任务（防重复语义锁定现状） |

### G2 归属消歧 / 私聊确认（resolve 分支）
| # | 步骤 | 断言 |
|---|---|---|
| G2.1 | 预置两人共享别名（alias 表各插一条"小张"）；发"让小张跟进一下"（mock intent 第三人称） | 判定为歧义：生成私聊确认（ai_dm 出站记录 / resp 含确认流程标识），任务进入待指派-私聊流程而非直接弹群确认卡 |
| G2.2 | resolve_assignee_reply 回复选人（数字/姓名两种形态） | 任务 assignee 落为所选 person；流程状态收敛 |
| G2.3 | 无负责人话术（mock intent: is_task 无 assignee） | 任务带"待指派"语义进入看板；不产生 @人的 ai_dm |

### G3 RBAC 与审批
| # | 步骤 | 断言 |
|---|---|---|
| G3.1 | POST /api/role/set 设 member→查 GET /api/role/{uid} | 角色读写一致 |
| G3.2 | member 触发高风险动作（外发/删除类，经 require_approval） | 生成 pending 审批记录，动作未执行 |
| G3.3 | admin POST /api/approvals/{id}/decide approved=true | 审批闭合、审计留痕、动作放行标记 |
| G3.4 | can_do 权限矩阵抽查（member vs group_admin 各一项差异动作） | 结果符合现 rbac 语义 |

### G4 记忆与上下文注入
| # | 步骤 | 断言 |
|---|---|---|
| G4.1 | POST /api/term/add {红字版, meaning} | GET /api/terms 可见 |
| G4.2 | POST /api/grp/meta 设置简介；再发一条消息（mock intent 返回透传 sys_ctx echo） | build_sys_ctx 注入包含该术语与群简介 |
| G4.3 | memory_proofs("红字版") 溯源 | 返回 term 依据（含来源） |
| G4.4 | 驳回带 reason=“负责人错了”后再查询该群记忆 | 修正信号已沉淀（alias/term 或 audit 可见） |

### G5 汇总 / AI DM / 审计
| # | 步骤 | 断言 |
|---|---|---|
| G5.1 | 制造 N 条 unconfirmed（低置信）任务后 GET /api/summary/daily | 汇总包含全部 pending/unconfirmed 条目且字段完整 |
| G5.2 | GET /api/ai_dm（G2 产生的会话） | 私聊记录存在；unread_count 正确；mark_read 后归零 |
| G5.3 | 任一写操作后 GET /api/audit | 对应 actor/action 记录存在 |

**通过标准**：以上 ≥25 项断言全绿；总耗时 <30s；连续重复跑 3 次结果一致（无脏数据残留）。

## 5. Eval 层：意图判定误判样本集 v1（≥22 条）

形式：`tests/eval/samples_v1.jsonl`，每行 `{id, category, text, sender, expect{...}, note}`。跑完输出报表：每类命中率 + 失败样本原文 + 实际输出对照。**首轮跑完后将实际命中率登记为基线数值**，此后作为回归参考线。

| 类别 | 样本要求 | expect 要点 |
|---|---|---|
| A 明确指派（3） | "@张伟 你来搞部署""这事你负责跟进" | is_task=T, mode=assign_other, assignee=被点名者 |
| B 主动认领（3） | "我来出物料清单""这周我把服务器搞好" | is_task=T, mode=self, assignee=sender |
| C 第三人称指派（3） | "让小王跟一下供应商" | is_task=T, mode=other, assignee=小王(经 alias) |
| D 无人认领（3） | "这周得把方案发出去" | is_task=T, assignee=空/待指派, 不实时弹卡 |
| E 模糊承诺（2） | "这个我看看吧" | 疑似/medium，进疑似列表 |
| F 非任务干扰（5） | "哈哈 ok""收到""辛苦了""今天天气不错""好的没问题" | is_task=F（最高优先质量线） |
| G 截止变体（3） | "周五前交" / "下周一给我" / "尽快搞定一下"（无显式时间→不带瞎编 deadline） | deadline_hint 命中/为空的正确性 |

**初始质量线（2026-08-26 定）：F 类误判 ≤1 条；总体判定 ≥90%。

**首轮实测基线（2026-08-27 登记）**：硬判命中 **19/20（95%）**；A/B/C 三类全对；F 类闲聊误报 **0/5**；G 截止变体 3/3；唯一 miss 为 D3『库存报表还没人做呢』催办语境判非任务 → **催办类识别是已知短板**，调 prompt 时优先补；E 类观察区行为在产品定义区间内。详细报表见 tests/eval/report_baseline.json，每次改 prompt/换模型后重跑对比此表。Eval 失败不影响 Guard 通过，两者独立。

## 6. 目录与运行方式（落地后的形态）

```text
im-ai-office/
├── tests/
│   ├── conftest.py            # IMAI_DB=tmp、llm_chat monkeypatch、TestClient 封装、客户端 fixture
│   ├── guard/
│   │   ├── test_g1_tasks.py
│   │   ├── test_g2_disambiguation.py
│   │   ├── test_g3_rbac.py
│   │   ├── test_g4_memory.py
│   │   └── test_g5_summary_dm_audit.py
│   └── eval/
│       ├── samples_v1.jsonl
│       └── test_intent_eval.py   # 默认 skip；显式 --run-eval 才连真实 LLM
└──（存量不动）test_flow.py      # E2E 最终验证
```

```bash
# 日常高频（重构守卫）：无外部依赖
python3 -m pip install pytest httpx        # 仅新增这两个依赖
python3 -m pytest tests/guard -q

# AI 质量评测：改 prompt / 换模型 / 提醒调参时手动跑
python3 -m pytest tests/eval --run-eval -q

# 发版前终验（全链路真实环境）
python3 cli.py up && python3 test_flow.py
```

依赖变更：`requirements.txt` 增加 `pytest`、`httpx`（其余复用现有）。

## 7. 明确不做（防扩散）

- ❌ 不做前端 UI 自动化（T1/T2 维持人工+截图）
- ❌ 不引入 coverage/CI 平台（单人阶段以本地命令行为准，收益不够）
- ❌ Guard 不测 LLM 质量、Eval 不测 API 结构（职责互斥，避免维护两套重叠断言）
- ❌ 不改动任何生产代码路径（唯一例外：startup 网关容错开关，实施时验证必要才加）

## 8. 实施清单（Checklist · 已全部完成 ✅）

- [x] 1. conftest 隔离设施（临时库 + fake_llm 按 msg 路由 + TestClient + OpenIM 发送 stub）
- [x] 2. G1 任务生命周期 5 用例 + G1.4b 正则误沉淀现状锁定 → 实际 6 用例
- [x] 3. G2 消歧/私聊 5 用例（含单命中分支与 callback 回复路径）
- [x] 4. G3 RBAC/审批 6 用例
- [x] 5. G4 记忆/注入 5 用例
- [x] 6. G5 汇总/DM/审计 3 用例
- [x] 7. samples_v1.jsonl 22 条 + eval runner + 首轮基线 19/20 已登记上表
- [x] 8. requirements.txt 增加 pytest/httpx → commit + tag `step0-done`

### 附：Step 0 实测发现的生产代码现状缺陷（未修复，待后续排期）
| # | 缺陷 | 锁定用例 | 建议 |
|---|---|---|---|
| 1 | reject 理由正则过宽：『这不是任务』被误提取人名沉淀 term（人称:任务） | g1_4b | 收紧 _memorize_reject_signal 正则 |
| 2 | 单聊回调检查 action=='assigned' 但函数返回 'confirmed'，告知分支死代码 | g2_5 注释 | 对齐字面量或删死代码 |
| 3 | 同消息重复投递无去重，双倍建任务 | g1_5 | Step2 幂等化一并解决 |
| 4 | simulate_message 不透传 group_id，记忆注入仅 callback 路径生效 | g4_2 注释 | Step1 重构时补齐参数贯通 |

---

*完成状态：✅ 已达成（2026-08-27）。Guard 26 用例全绿且重复 3 次一致（≤0.2s）、imai.db 全程 md5 未变；Eval 首轮 19/20 已登记。**Step 0 完成，具备进入 Step 1 拆层重构的条件。***
