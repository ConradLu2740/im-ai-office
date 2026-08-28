# IMAI · 部署收尾与 LLM 重试 Spec（迭代 2）

时间：2026-08-28 ｜ 依据：《架构分析报告.md》遗留项 + 迭代 1 收尾时确认的"第一梯队后清单" ｜ 前置：迭代 1 已归档（tag `remind-fixes-done`，47 用例全绿）

## 背景

架构迁移四步（Step 0-4）与迭代 1（提醒调度 + 四缺陷修复）已收官。上会话收尾时与用户确认的下一轮节奏：**先部署收尾（一次性清掉），再做 LLM 调用重试（实测痛点）**。本轮目标：让项目达到"可放心给团队真实使用"的状态。

## 范围

### R1 · `.env` / `.env.example` 部署修正

现状（2026-08-28 侦察）：

| 问题 | 现值 | 后果 |
|---|---|---|
| `DATABASE_URL` 主机名 | `postgresql://imai:***@postgres:5432/imai` | `postgres` 是 compose 容器名，宿主机不可达；`imai/db.py` 检测到 postgres 前缀即切 PG 后端 → 宿主机启动即连库失败 |
| `REDIS_URL` 变量名错误 | `redis://redis:6379` | `imai/config.py` 实际读取 **`IMAI_REDIS_URL`**（默认 `redis://127.0.0.1:6379/0`），此行是死配置；且 `redis` 主机名宿主机同样不可达 |

修正：
1. `DATABASE_URL` → `postgresql://imai:***@127.0.0.1:5432/imai`（compose 已发布 5432 到宿主机）
2. `REDIS_URL` → 改名 `IMAI_REDIS_URL=redis://127.0.0.1:6379/0`，附注释说明容器内部署由 docker-compose 注入环境变量，勿在容器场景读此文件
3. `.env.example` 同步两处修正
4. `docker-compose.yml` **不动**（容器间主机名 `postgres`/`redis` 在 compose 网络内本就正确；其中硬编码的连接串与根 `.env` 无变量替换关系）

验收：宿主机 Python 用 `.env` 配置连 PG 与 Redis 各一次成功；`git status` 不出现 `.env`（已被 ignore）。

### R2 · LLM 调用重试与空响应兜底

现状：`imai/integrations/llm_provider.py::llm_chat` 单次 urllib 调用，无重试。昨晚实测 DeepSeek 有间歇性空响应/瞬时网络错误，当前行为是静默漏判：空 content → `pipeline.intent_detect` 里 `json.loads` 抛异常 → 兜底 `{"is_task": False, "confidence": "low"}`。

设计（保持 urllib，httpx 化是独立小步不扩 scope）：
1. HTTP 请求抽为模块内 `_post(payload)` 小函数，便于测试注入
2. 重试判定：
   - **可重试**：`URLError`（含超时）、`HTTPError` 状态码 5xx/429、HTTP 200 但响应体非法 JSON / 缺 `choices` / `content` 为空
   - **不重试**：`HTTPError` 4xx（除 429）——认证/参数错误重试无意义，立即抛
3. 次数与退避：总尝试 = 1 + `IMAI_LLM_RETRIES`（env，默认 2）；退避 `0.5s × 2^attempt`；sleep 经模块级 `_sleep` 封装，测试可置零
4. 重试耗尽抛最后一个异常，由 `intent_detect` 现有 `except` 兜底承接——**上层契约零变化**；`llm_chat` 唯一生产调用点即 `pipeline.py:35`
5. 测试锚点不受影响：Guard 层 monkeypatch 的是 `pipeline.llm_chat` 绑定，不经过本模块

验收：新增 `tests/test_llm_provider.py`（fake `_post` 序列注入）：
- 空响应 → 重试 → 成功，返回正常内容
- 首两次 `URLError` → 第三次成功
- 429 → 重试后成功
- 401 → 不重试立即抛（断言调用次数 = 1）
- 重试耗尽 → 抛异常（断言调用次数 = 1 + N）
- 全量回归不回归

### R3 · `tauri build` 打包验证

Step4 变更过 CSP 与 resources 白名单，需完整打包验证。工具链已确认在位（cargo/rustc/node/npm），`desktop/src-tauri/target/release` 有缓存，`beforeBuildCommand` 为空、`frontendDist` 指向静态 `../src`。

执行：`cd desktop && npx tauri build`（targets "all" → .app + .dmg）。
验收：构建退出码 0，产物存在于 `src-tauri/target/release/bundle/`。GUI 实际运行行为（登录、发消息、AI 回复）仍需用户人工开一次——Agent 无法代验。

### R4 · `IMAI_AI_MODE` 默认值决策 + 归档

- 决策点：async 是否转正为默认。上会话建议"稳定观察一段时间"——截至今天观察期仅一夜，**建议暂不翻转**，保持 sync 默认，在 `.env.example` 注释中说明如何开启 async 观察。最终由用户拍板。
- 归档：全量 pytest → git commit（`Made-with: Proma` trailer）→ tag `deploy-llmretry-done` → 记忆更新。

## 非目标（本轮不做）

- 旧 `services/` 容器组下线/标注废弃（下一轮或与部署实操一起做）
- deadline 解析器长尾扩充、LLM 输出 JSON 修复（retry 只解决传输层空响应，不做 JSON 语义修复）
- `IMAI_AI_MODE=async` 翻转默认（除非用户拍板）
- 产品演进类（迭代 2 功能、会议纪要、记忆增强）——需单独产品讨论
