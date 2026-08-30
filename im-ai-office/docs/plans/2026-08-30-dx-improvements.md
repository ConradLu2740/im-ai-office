# 开发/测试体验（DX）改进 Spec

> 更新：2026-08-30 · 范围：只动开发流程，不动生产架构与框架选型

## 背景痛点（全部为 2026-08-30 实际踩过）

1. Windows GBK 控制台：诊断脚本手动包 UTF-8 wrapper、acceptance 输出乱码
2. 环境 stealth 不一致：后端连 PG、shell 裸跑脚本连 SQLite，数据对不上排查耗时
3. 测试前置重：真 Redis db15 + `imai_test` 库的准备是口头知识
4. 改后端要手动杀端口重启
5. desktop/src/app.js → web/app.js 手动 cp，忘 cp 即灵异 bug
6. LLM fake 的 patch 点是隐性约定（pipeline.llm_chat），新服务直连 provider 会绕过 mock 打真 LLM（实测慢 25s + 烧钱）

## 改动项

| # | 改动 | 产出 |
|---|---|---|
| D1 | 全局 UTF-8：`setx PYTHONUTF8 1`（用户级环境变量）+ pytest.ini 固化 | 控制台/脚本乱码消失 |
| D2 | 统一环境引导：新建 `imai/boot.py`（load_dotenv + 打印 BACKEND/库地址），app.py 及所有脚本/测试入口 import | "连的哪个库"永远显式 |
| D3 | LLM 显式锚点：新建 `imai/llm.py::get_llm()`，pipeline/minutes 改经它调用；conftest 同时 patch 该处；加守卫用例 | patch 点从约定变契约 |
| D4 | `pytest.ini`：marker 分层（guard/async/pg/eval），日常 `-m guard` 3 秒跑完核心层 | 快速反馈 |
| D5 | `scripts/dev.ps1`：一键起后端（uvicorn --reload）+ 网关 + app.js 文件监听自动 cp 到 web/ | 改码即生效，cp 纪律自动化 |
| D6 | `scripts/test-env.ps1`：检查 redis/pg 可达 → 确保 `imai_test` 库存在 → 跑 pytest（可传参选层） | 测试准备一条命令 |

## 不做
- 不换框架、不上 Docker 开发容器、不换测试框架
- 不上 uv/Vite（待 B4 前端再动工时一并评估）

## 验收
- [ ] 新开 PowerShell `python -c "import sys;print(sys.stdout.encoding)"` → utf-8
- [ ] `python -c "import imai.boot"` 打印 `backend=postgres ...`（或 sqlite，但永远显式）
- [ ] `scripts/test-env.ps1` 一键跑完 guard 层全绿
- [ ] uvicorn --reload 下改 services 代码，无需重启即生效
- [ ] 改 desktop/src/app.js，web/app.js 2 秒内自动同步
- [ ] 守卫用例通过；全量 pytest 无回归
