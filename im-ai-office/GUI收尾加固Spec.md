# IMAI · GUI 收尾加固 Spec（迭代 2.5）

时间：2026-08-28 ｜ 前置：GUI 实测大修完成（commits 89d9ddf/6a2aa62/8f21544/4bd06fa/d56c85d）｜ 用户已确认范围（①②③打包）

## ① guard_async 负载 flake 加固

**实测根因**（2026-08-28 14:0x 复现）：guard_async 的 fake_llm 为函数级 monkeypatch，
用例结束即还原为真 LLM；worker 后台线程在用例间隙处理漏网消息时会打**真 LLM**
（网络调用 3-90s，叠加重试更久），吃掉后续用例的等待窗口 → `test_eventual_task_state`
超时 + SQLite 锁冲突报错。

修复：
1. guard_async/conftest.py 增加会话级 autouse `_llm_never_real`：pipeline.llm_chat
   永久替换为假兜底（is_task=False）；函数级 fake_llm 在其上覆盖，用例结束还原到
   兜底而非真 LLM——**竞态窗口确定性消除**
2. db.py：SQLite 连接 busy timeout 5s → 15s（锁冲突容忍度提升）

验收：全量 pytest 连续 3 轮全绿。

## ② 旧 services/ 容器组下线

现状：imai-reminder / imai-board-api / ai-agent / oim-webhook 为旧架构容器组，
imai-reminder、imai-board-api 已 Up 6 天（无人使用，纯干扰）。

1. `docker stop` + `docker rm` 上述容器（存在者）
2. docker-compose.yml：四个旧服务加 `profiles: ["legacy"]`——`docker compose up`
   不再拉起，需要时 `docker compose --profile legacy up` 显式启动
3. README「联调 OpenIM」附近标注旧架构容器组已下线

验收：`docker ps` 无 imai-reminder/imai-board-api/ai-agent/oim-webhook；postgres/redis/openim 不受影响。

## ③ 内联 onclick → 事件委托重构

背景：Tauri CSP 与内联处理器天然冲突（unsafe-inline 会被 nonce 架空，
dangerousDisableAssetCspModification 属危险开关）。治本：移除全部内联 onclick。

1. 静态按钮（登录/发送/退出/模拟器/刷新×N/生成汇总）：改 id + addEventListener
2. 动态条目（会话列表、任务卡确认/驳回、审批/记忆操作）：改 `data-action` +
   `data-*` 参数 + 单个 document 级委托分发器
3. CSP 收回 unsafe-inline：`script-src 'self'`（style-src 保留 unsafe-inline）

验收：浏览器预览实证（渲染→委托点击→状态变化）；全量回归；重建安装。

## 非目标

- deadline 解析长尾、D3 prompt 调优（下一轮）
- async 默认值翻转（继续观察）
