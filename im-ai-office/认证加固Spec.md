# IMAI · 认证加固 Spec（Step 4）

> 时间：2026-08-27 ｜ 关联：《架构分析报告.md》Step 4（认证部分；前端框架化经评估推迟，见 §4）｜ 前置：step2-done
> 背景：现状 CORS `allow_origins=["*"]`、`/openim/login` 无凭据校验（任意 userID 可换 token）、`/api/role/set` 任何人可提权（击穿 RBAC 产品价值）、OpenIM 回调签名校验形同虚设（`_verify` 直接 return True）。

---

## 1. 目标

内网自用 ≠ 无权限边界。本轮把「信任边界」补齐到与 RBAC 产品主张一致：**API 可信、操作可溯源、越权不可能**。不上 SSO/2FA（成本不成比例）。

## 2. 加固项与机制

### 2.1 管理令牌（核心机制）
- 新 env：`IMAI_ADMIN_TOKEN`（部署时设置；`.env.example` 给生成指引 `python3 -c "import secrets;print(secrets.token_urlsafe(24))"`）
- 以下管理类端点要求请求头 `X-IMAI-Admin-Token` 匹配，否则 403：
  - `POST /api/role/set`（**修复任意提权**）
  - `POST /api/approvals/{id}/decide`（审批决定属管理员职责）
- 兼容期：token 未设置时保持旧行为并打 WARN（避免升级即锁死）；一旦设置即强制。桌面端审批页后续版本带令牌输入（先文档化用 curl/脚本管理角色）。

### 2.2 登录口令
- 新 env：`IMAI_LOGIN_PASSWORD`（团队共享口令；未设置时旧行为+WARN）
- `POST /openim/login` body 增加 `password` 字段，不匹配返回 `{"ok":false,"error":"password required"}`；匹配才走 OpenIM 换 token
- 桌面登录页加口令输入框（仅追加，记住上次输入由 localStorage，不入 code）

### 2.3 回调鉴权
- `POST /callback` 校验头 `X-IMAI-Token == env AUTH_TOKEN`（该 env 已存在用于 webhook 鉴权，复用）
- **AUTH_TOKEN 未设置时跳过校验 + WARN**（向后兼容，如 Step2 所停的 oim-webhook 若复活仍可配）

### 2.4 CORS 收紧
- `allow_origins` 改为 env `IMAI_ALLOWED_ORIGINS`（逗号分隔，默认 `tauri://localhost,https://tauri.localhost,http://localhost:1420,http://127.0.0.1:8000`）
- 同源请求（桌面 file/localhost 页面）不受 CORS 影响；浏览器 preview 跨源会被拒——预期行为，文档标注

### 2.5 Tauri CSP
- `security.csp: null` → 设置基础 CSP：`default-src 'self'; connect-src 'self' http://127.0.0.1:8000 http://127.0.0.1:8400 ws://127.0.0.1:8400; img-src 'self' data:; style-src 'self' 'unsafe-inline'`
- 打包前需 `tauri build` 人工验证（延续 Step1 警示）

## 3. 测试策略

- 新增 `tests/guard_auth/`（~6 用例）：role/set 无令牌 403 / 带令牌成功 / login 口令错 403 / 口令对换 token / callback 无 token 头被拒（设置后）/ CORS 拒绝跨源预检（TestClient OPTIONS）
- 兼容回归：未设置 env 时全量 guard 存量必须原样全绿（加固是"设置即强制"，不设不破坏）
- 桌面端：登录框追加后手工冒烟

## 4. 前端演进决策（S4-D1，待拍板）

**建议：本轮不动前端结构**（不加框架、不拆文件），仅追加登录口令输入框与审批页令牌输入。理由：
- 871 行原生 JS 当前**可用且被安全网间接覆盖**（API 契约由 Guard 锁定）；拆分收益是可维护性，但无回归测试覆盖前端，重写/搬迁风险 > 收益
- Vue/ES modules 的再评估触发条件（文档化）：① 出现新面板需求 ≥2 个 ② 多人协作前端 ③ 单文件变更冲突成为日常
- 若你倾向现在就上 Vue 3：范围将扩大为 ~871 行重写 + 构建链 + 打包清单变更，需要独立一轮

## 5. 验收标准（DoD）

1. 未设置任何新 env：全量测试原样全绿（兼容性铁律）
2. 设置后：三条越权路径全部 403/拒答（提权/匿名登录/无凭证回调）；带凭证路径正常
3. guard_auth 全绿；桌面手工冒烟：登录→聊天→任务→审批全链路
4. 回滚：删除新增 env 即回旧行为

## 6. 明确不做

❌ SSO/2FA/JWT 体系 ❌ HTTPS/反代（内网明文现状保留）❌ 前端框架迁移 ❌ 细粒度资源级权限（Spec 原有"不做"延续）❌ 密码找回/多用户管理面
