# IMAI办公助手 · 桌面应用

对话式 AI 办公的桌面端。双击图标启动，内置自动拉起 Python 后端，可直接体验 AI 识别群消息 → 任务落库 → 人审确认的完整闭环。

## 产物位置

构建成功后产物在：

```
im-ai-office/desktop/src-tauri/target/release/bundle/
├── macos/IMAI办公助手.app          ← 双击运行（推荐）
└── dmg/IMAI办公助手_0.1.0_aarch64.dmg ← 可分发安装包
```

## 运行方式

### 方式 A：直接运行 .app（最简单）

1. 双击 `IMAI办公助手.app`
2. 首次启动 macOS 可能会提示“无法打开”，前往 **系统设置 → 隐私与安全性 → 安全性** 点击“仍要打开”
3. 应用会自动检测并启动 Python 后端（端口 8000）
4. 窗口加载后即可输入群消息测试

### 方式 B：开发调试

```bash
cd im-ai-office/desktop
npm install
npm run tauri dev
```

开发模式会自动启动前端 dev server，并拉起 Tauri 桌面窗口。

### 方式 C：手动启动后端 + 浏览器

如果暂时不需要桌面壳，只想验证后端：

```bash
cd im-ai-office
python3 app.py
# 浏览器打开 http://127.0.0.1:8000
```

## 后端怎么打包进去的

Tauri 构建时会把以下文件复制到 `.app/Contents/Resources/backend/`：

- `app.py` — FastAPI 服务
- `core.py` — 意图识别 / 归属消歧 / 数据落库核心
- `imai.db` — SQLite 数据库

桌面应用启动时，Rust 侧会调用系统 `python3` 运行 `Resources/backend/app.py`，并轮询 `http://127.0.0.1:8000/api/tasks` 直到后端就绪。

## 如何接入真实 OpenIM 群聊

当前 `.app` 内置了可独立运行的 Python 后端，但**真实群聊旁听**还需要 OpenIM 服务端把群消息回调指过来：

1. 部署 OpenIM 服务端（参考项目根 README）
2. 在 OpenIM 回调配置里开启 `afterSendGroupMsg`
3. 回调地址填 `http://<你的机器IP>:8100/callback`（指向 `services/oim-webhook`）
4. 启动 `oim-webhook` 和 `ai-agent` 服务
5. 桌面应用保持运行，即可在群里@AI 或自然对话，AI 会自动识别任务

> 当前 MVP 桌面壳主要负责：本地窗口、任务看板、确认卡操作。真实群聊回调链路在服务端完成，与桌面壳是互补关系。

## 已知限制

- macOS 仅构建 **Apple Silicon (aarch64)** 版本；如需 Intel 版本，需要在 Intel Mac 上重新执行 `npm run tauri build`
- 依赖系统已安装 `python3` 及 `fastapi`/`uvicorn`/`pydantic`；如未安装，后端会自动启动失败，界面右上角会显示“后端未启动”
- Windows 版本需要 Windows 环境重新构建

## 构建

```bash
cd im-ai-office/desktop
npm install
npm run tauri build
```

构建完成后产物在 `src-tauri/target/release/bundle/`。
