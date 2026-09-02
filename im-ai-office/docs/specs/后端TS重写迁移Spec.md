# IMAI · 后端 TS 全量重写迁移 Spec（2026-09-02）

> 决策：用户确认（动机：全栈统一语言 + 端到端类型安全 + Node 生态）。采用**直接全量重写**，HTTP 契约与 Python 版 1:1，前端与 acceptance.py 零改动迁移。
> 技术栈：**Node 22 + Hono + Zod + postgres.js + Vitest**。目录 `backend-ts/`，端口 8000 不变。

## 1. 范围

**迁移**：全部 9 个路由模块的 HTTP 契约、pipeline/resolve/完成识别、tasks/ai_dm/actions/memory/rbac/reminder/digest/minutes/mine/stats、deadline_parser（逐字规则移植）、SSE bus（进程内 fanout）、scheduler（setInterval 线程）、审计、去重闸门、三方校验（admin/login/callback token）、静态托管 web/。

**范围裁剪（重写即决策）**：
- ❌ async 模式 + worker + Redis Streams 不迁移（G5 遗留税，sync 是唯一形态）；Redis 容器保留（OpenIM 自用）
- ❌ SQLite 方言不迁移：PG-only，测试连 `imai_test` 库（双方言税随重写消亡）
- ❌ EVENTS 内存事件列表不迁移（幽灵路径，G6 登记项一并清掉）
- ✅ acceptance.py 保留（HTTP 驱动，打 TS 后端）；eval/tests eval 层保留 Python（打真模型的评估层，独立于后端）

## 2. Parity 映射表（Python → TS）

| Python | TS | 备注 |
|---|---|---|
| `imai/db.py`（双方言+翻译层） | `src/db.ts`（postgres.js，原生 `$n`/`NOW()`） | 翻译层消亡；schema 1:1（IF NOT EXISTS + 种子）；audit 旧 schema（created_at/JSONB）运行时兼容**必须保留** |
| `imai/llm.py` + `llm_provider.py` | `src/llm.ts` | retry 语义 1:1（5xx/408/429/空响应重试，指数退避）；新增 `parseIntent`（Zod schema + 验证失败重试） |
| `pipeline.py` | `src/pipeline.ts` | prompt 逐字保留；intent schema 同构（is_completion 含）；resolve/handleCompletion 1:1 |
| `deadline_parser.py` | `src/deadline.ts` | 规则逐字移植（含时刻点）；backfill + deadline_unparsed |
| `tasks/ai_dm/actions/memory/rbac/reminder/digest/minutes/mine/stats` | 同名 ts 模块 | 文案逐字保留；EVENTS.append 全部删除 |
| `routes_*`（9 模块） | `src/routes/*.ts` | 路径/方法/JSON 形状 1:1；`/api/sdk_message` 保留为测试入口（sync-only） |
| `scheduler.py` | `index.ts` 内 setInterval | REMIND_INTERVAL_SEC=0 关闭语义保留 |
| `conftest.py` fresh_db | Vitest beforeEach wipe+seed（imai_test 库） | guard_pg 模式 |

**测试**：Vitest 移植 G11/G12/G3 守卫 + parser 全量 + reminder judge_tiers + dedup；`acceptance.py` 12 项作为最终 parity 门禁。

## 3. 顺序与验收

S1 骨架+基础层（config/db/sse/llm/deps）→ S2 服务层 → S3 路由+静态 → S4 Vitest 绿 → S5 8001 并行真跑（OpenIM 回调指回验证）→ S6 切 8000 + acceptance 12/12 + 浏览器 E2E → S7 部署脚本切换 + Python 下线 + 文档。

**回滚预案**：Python 代码在 git 历史；切换前打 tag `python-backend-final`。
