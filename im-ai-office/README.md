# IMAI · 对话式 AI 办公助手

> 内部自用 · 单机部署 + Tailscale 跨区域团队接入 · TypeScript 全栈（Hono + Drizzle + Electron）· 零 Docker / 零 Python / 零 Rust 工具链

## 它是什么

群聊里说“XX 下午写个报告”，AI 自动识别任务 → 确认卡找人拍板 → 看板跟进 → 到期提醒 → 完成闭环。
界面为 UI 骨架 v2：左侧导航七视图（聊天/任务工作台/审批/记忆/汇总/权限/设置）、AI 统一卡片语言、三态存在规则、浅深双主题、记忆页拟人化。
团队成员分布不同区域也能用：主机 + 全员装 Tailscale（免费加密组网）即可，见[团队部署](#团队部署tailscale-跨区域)。

---

## 一、快速上手（30 秒）

1. 浏览器打开 `http://<主机地址>:8000`（内网用主机 IP；跨区域用 Tailscale 虚拟 IP，见[团队部署](#团队部署tailscale-跨区域)）
2. 用管理员分配的账号密码登录
3. 左侧进【聊天】，像平时说话一样安排一件事，比如：

   > 李娜 明天上午10点前把测试报告发我

4. AI 生成确认卡找你拍板 → 点【确认】→ 任务进看板，到点自动提醒负责人

就这些——**安排任务不需要点任何界面，说话就行**。

## 二、怎么用（按角色看）

### 📌 我是组长：安排任务

不用学任何操作，在聊天框里像平时说话一样：

> 李娜 明天上午10点前把测试报告发我
> 小张 周五前出季度数据报表
> 这事还没人负责呢（→ AI 识别为待认领任务）

AI 生成确认卡找你拍板（负责人/时间对不对），确认后任务进看板并自动开始提醒。说错了随时驳回或编辑。

### 📌 我是成员：任务找上我了

- 打开软件，左侧【任务】图标有**红色数字** = 有事等你拍板
- 进【任务工作台】，最上面一排“需要你处理”就是找你的卡：【确认】/【驳回】（选原因）/【改负责人】
- 处理完该干嘛干嘛；到截止前 AI 会自动提醒你（24h 前 / 当天 / 逾期标红）

### 📌 活干完了

两种方式随你：

- 看板任务卡上点【完成】按钮
- 或者直接在群里说“**我做完了**”——AI 听得懂，自动闭环

### 📌 AI 认错人了

- 驳回时选择原因（负责人错了/不需要建任务/时间不对/内容不对/其他）
- 如果它叫错了人，在群里纠正：“应该是小张为”——**AI 会记住，下次不再犯**
- 团队来了新人/新外号：在【记忆】页手动添加，或让 AI 在纠正中自己学

### 📌 界面导览（左侧导航）

| 视图 | 一句话 |
|---|---|
| 💬 聊天 | 说话和聊天的地方，任务从这里来；AI 助手置顶会话接收确认与提醒 |
| 📋 任务 | 所有任务的全貌：待处理横排 + 四列看板（待指派/待确认/进行中/已完成），逾期标红置顶 |
| ✅ 审批 | 高风险操作（如群发通知）的把关台 |
| 🧠 记忆 | AI 认识谁、记住了什么术语、最近学了什么——每条可纠正，删除仅管理员 |
| 📊 汇总 | 每日自动生成的团队动态 + 纪要 + 已取消/已驳回归档 |
| 🔑 权限 | 谁是管理员、审计日志 |
| ⚙️ 设置 | 默认落地页（聊天/任务）、浅深主题、退出登录 |

### 📌 每日动线

- **成员**：打开 → 看红点 → 处理待办 → 走人（30 秒）
- **组长**：打开 → 工作台扫一眼逾期 → 【汇总】看昨日动态

## 三、团队部署（Tailscale 跨区域）

成员不在同一局域网时，主机与全员各装 [Tailscale](https://tailscale.com)（免费加密组网）并登录同一账号，
浏览器访问主机虚拟 IP（如 `http://100.x.y.z:8000`）即可，数据端到端加密、零公网暴露。
方案与风险详见 `docs/specs/团队分布式部署Tailscale-Spec.md`，同事接入三步见 `docs/同事接入说明书.md`。
同一局域网内则直接访问主机内网 IP。完整方案与运维 SOP 见 `交接文档.md` 部署章节（本机文件）。

账号由管理员用 `cd backend-ts && npx tsx scripts/set-password.mts <username> <password> [user_id]` 开通/重置。

---

## 四、技术部分

### 架构一句话

```
Electron 壳（托盘/系统通知/开机自启/后端子进程生命周期）
   │ HTTP(127.0.0.1:8000) + SSE 实时事件
Hono/TS 后端单体（Zod 校验 · Drizzle 数据层 · scrypt 会话认证 · AI 管线）
   │
单一 PostgreSQL（业务 + 聊天，schema 由 drizzle-kit 迁移管理）
```

聊天层为自建实现（2026-09-02 切流）：消息落库 → SSE fanout（携 DB id + client_msg_id 双去重键）→
内联 AI 闸门（意图识别/归属判定/确认卡）。OpenIM 已退役并物理下线（2026-09-03，详见交接文档）。

### 代码结构（npm workspaces monorepo）

```text
im-ai-office/
├── package.json               # workspaces: backend-ts / frontend-ts / electron
├── backend-ts/                # TS 后端（Hono + Zod + Drizzle + pg + Vitest）
│   ├── src/index.ts           # 入口（8000 端口，静态托管 web/ + 提醒调度）
│   ├── src/app.ts             # 路由链式组装 + export type AppType（Hono RPC 契约）
│   ├── src/pipeline.ts        # AI 编排：意图识别(Zod) → 归属判定（别名最长匹配）→ 落库
│   ├── src/auth.ts            # scrypt 口令 + session token（30 天）
│   ├── src/db/schema.ts       # Drizzle schema（16+ 表，生产库内省基线）
│   ├── src/db.ts              # initSchema = drizzle migrate + 种子
│   ├── drizzle/               # 迁移（0000 audit 对齐 → 0001 聊天层新表…）
│   ├── src/routes/            # auth / messages(发送+会话+未读) / tasks / rbac / memory / misc / extra
│   ├── e2e/                   # acceptance 12 项 Vitest E2E（打真实环境）
│   └── scripts/               # import-openim.mts（Mongo 一次性导入）/ set-password.mts（口令分发）
├── frontend-ts/               # 原生 TS 前端（esbuild 单文件打包到 web/）
│   ├── src/api.ts             # API 层（hc<AppType> Hono RPC + Bearer 会话，无 @ts-nocheck）
│   ├── src/app.ts             # UI 逻辑（导航七视图/任务工作台/卡片系统，tsc 0 错误）
│   ├── src/__sentinel__/      # RPC 契约哨兵测试（拼错端点/方法 → 编译失败）
│   └── static/                # index.html / styles.css 单一来源
├── electron/                  # Electron 桌面壳（2026-09-02 替代 Tauri）
│   ├── src/main.ts            # 窗口 / 托盘未读 / SSE 通知桥 / 注册表自启
│   ├── src/backend.ts         # 后端子进程：spawn / 端口预检 / crash 退避 / taskkill 进程树
│   └── release*/              # 安装包（IMAI Setup.exe，不入库）
├── web/                       # 后端静态目录（frontend-ts 构建产物）
├── scripts/quality-report.mjs # 识别质量报告（含真实口径通过率/分源延迟，只读）
└── docs/                      # 计划与 Spec（含《统一技术栈架构演进Spec.md》）
```

### 开发快速开始

依赖：Node 22+、PostgreSQL 16（Windows 原生或任意 PG 实例）。

```bash
npm install                # workspaces 一次装全
cd backend-ts
npx drizzle-kit migrate    # 空库自动建全表（迁移由 journal 管理）
```

```bash
npm run dev:backend        # 开发：后端（等价 cd backend-ts && npx tsx src/index.ts）
npm run dev:frontend       # 开发：前端（改动实时打包到 web/）
npm run dev:electron       # 桌面端（推荐）：Electron 自动拉起后端
# 打包 Windows 安装包：cd electron && npx electron-builder --win
```

`/api/auth/login`（username + password → session token，30 天）。
账号口令由管理员用 `cd backend-ts && npx tsx scripts/set-password.mts <username> <password> [user_id]` 分发。

### 环境变量（仓库根 .env，永不提交）

| env | 作用 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串（默认 `postgresql://imai:imai_secret@127.0.0.1:5432/imai`） |
| `LLM_BASE` / `LLM_API_KEY` / `LLM_MODEL` | LLM provider（DeepSeek 兼容；v4-flash 为推理型输出，max_tokens 需 ≥4096） |
| `IMAI_ADMIN_TOKEN` | 角色设置/审批决定需带 `X-IMAI-Admin-Token` 头（未设置=放行+WARN） |
| `IMAI_LOGIN_PASSWORD` | 已废弃（P3 改 per-user scrypt 认证） |
| `AUTH_TOKEN` | 已废弃（OpenIM 回调随 P3 切流下线） |
| `OPENIM_API` / `OPENIM_SECRET` | 仅切流前使用，切流后可从 .env 移除 |

### 测试

```bash
cd backend-ts
npx vitest run                          # 单元守卫 23 项（G11-G18 + parser，imai_test 库，fake LLM）
IMAI_E2E_BASE=http://localhost:8000 npx vitest run --config vitest.e2e.config.ts
                                        # acceptance 12 项 E2E（真实 LLM + 生产库，标记 e2e 自动清理）
node ../scripts/quality-report.mjs      # 识别质量报告（含真实口径通过率/分源延迟，只读）
```

测试约定：E2E 文本用「房间号/编号」等自然尾缀保证唯一（避开 30 分钟确定性去重窗口）；
数据标记 `张敏(e2e)` / `e2e-*`，跑完自动清理。

### OpenIM（已退役）

2026-09-02 切流自建聊天层，OpenIM 不再参与任何链路；2026-09-03（Task 3.7）全部容器、镜像与数据卷已物理删除，Docker 不再是运行依赖。历史代码见
git tag `python-backend-final`（Python 时代）与 `openim-era-final`（OpenIM 时代终态）。

### 关键设计决策

| 决策 | 原因 |
|---|---|
| SSE 而非 WebSocket | 聊天=推送+HTTP 发送+断线拉历史，SSE 已验证够用，省去连接管理/心跳/鉴权一类复杂度 |
| 消息唯一渲染权威 = DB | 本地回显 → SSE 回声 → 历史重建三层去重（client_msg_id + db_id），重连全量刷新兜底 |
| UNIQUE(conv_id, client_msg_id) | 并发去重最终防线（check-then-insert 历史踩坑根因模式） |
| app_user.id 复用 OpenIM userID | 历史 message.sender_id / task.creator / role.oim_user_id 天然对齐，禁另起 id 体系 |
| LLM 唯一锚点 getLlm() | 服务层禁直连 provider；测试 setLlmImpl 注入；max_tokens ≥4096（v4-flash 推理型输出） |
| AI 三态规则 | 主动态（角标+卡片找人）/工作态（轻提示不弹窗）/静默态（隐形）——每个 AI 功能必须归属其一，防“为存在感而吵” |
| 别名最长匹配优先 | 归属判定子串匹配时，长命中覆盖短别名（“小张为”不被短别名“小张”扩成多人歧义，G18） |
| 静态资源 no-cache + 构建时间戳指纹 | 启发式磁盘缓存曾致 Electron 更新后仍跑旧 JS（SSE 自愈代码加载不到） |
