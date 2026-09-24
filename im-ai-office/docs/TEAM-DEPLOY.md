# IMAI 团队部署 Runbook（10–50 人内网）

> P0 安全加固后的部署基线。适用形态：**一台常驻服务器跑 backend + PostgreSQL，成员用浏览器访问**。
> 不要每人本地跑一个 Electron 实例——数据分裂，看板/私信/任务不互通。

## 1. 服务器要求

| 项 | 要求 |
|---|---|
| Node | 20 LTS（CI 同款；本地开发用 26 亦可） |
| PostgreSQL | 16（业务 + 聊天同一个库） |
| 网络 | Tailscale 或内网可达；**暂不要暴露公网**（无 Rate Limit/WAF） |
| 磁盘 | PG 数据目录 + 每日 pg_dump 备份 |

## 2. 获取代码与构建

```bash
git clone <repo> && cd im-ai-office/im-ai-office
npm ci
npm run build:backend
npm run build:frontend   # 产物落 web/（后端静态直出，同源部署）
```

## 3. 环境变量（.env 放 monorepo 根目录）

**必填**（就两个，其余都有默认值）：

```ini
DATABASE_URL=postgres://imai:<强口令>@127.0.0.1:5432/imai
LLM_API_KEY=<DeepSeek/OpenAI 兼容 key>
```

可选：`LLM_BASE`/`LLM_MODEL`（默认 DeepSeek）、`IMAI_TS_PORT`（默认 8000）、
`IMAI_REMIND_INTERVAL_SEC`（默认 60）、`IMAI_DIGEST_TIME`（默认 18:00）。

> 登录认证走 per-user scrypt 口令 + session token（`backend-ts/src/auth.ts`），
> 账号一律 CLI 建（见 §4），没有也不再用 `AUTH_TOKEN`/`IMAI_ADMIN_TOKEN`/
> `IMAI_LOGIN_PASSWORD` 这类全局令牌 env（P0 终审已删除，`.env.example` 里的
> Python 时代残留一并忽略）。

## 4. 初始化

```bash
# 1) 建库（PG 侧）
createdb -U imai imai

# 2) 跑迁移（Drizzle，0000–0002 幂等）
cd backend-ts && npx drizzle-kit migrate && cd ..

# 3) 建第一个管理员账号（无自注册，账号一律 CLI 建）
cd backend-ts
npx tsx scripts/set-password.mts admin <初始口令> admin "管理员"
cd ..
```

后续成员账号：重复 `set-password.mts <username> <password> <user_id> "<显示名>"` 即可（默认 member）。

## 5. 启动（常驻）

```bash
# 前台验证
cd backend-ts && npm start

# 常驻二选一：
#   Linux: systemd（Restart=always，WorkingDirectory=backend-ts）
#   Windows: 计划任务 / pm2
pm2 start "node dist/index.js" --name imai-backend --cwd backend-ts
```

## 5b. 授予管理员角色（服务起来之后）

管理端点（角色设置/审批）现在是「登录 + group_admin」双重要求。用刚才建的
admin 账号登录拿 session token，再调角色接口：

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<初始口令>"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -X POST http://127.0.0.1:8000/api/role/set \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"oim_user_id":"admin","role":"group_admin"}'
```

之后 RBAC 面板/审批按钮在 UI 里直接可用（前端带的是同一个 session token）。

## 6. 访问方式（重要）

**必须经反向代理到 80/443**（Nginx/Caddy/Tailscale Funnel 均可），原因：

- 前端 `API_BASE` 对 8000 端口有特例：直接 `http://服务器:8000` 访问时，页面会去打
  `http://127.0.0.1:8000`（用户自己本机），远程全员连不上（frontend-ts/src/api.ts:8）。
- 走标准端口时同源，API/SSE/静态全部自动配对。

反代只透传 HTTP 即可（SSE 关缓冲：`proxy_buffering off`）。

## 7. 安全基线（P0 加固后）

- 所有业务端点要求登录（session token，Bearer 头）；未登录 401
- 管理端点（角色设置/审批决定）= 登录 + group_admin 角色；member 403
- 挖掘裁决（`/api/mine/candidates/:cid/decide`）仅 group_admin——accept 写团队共享的
  person/alias/term；候选列表登录可读
- 会话历史成员校验：`/api/messages`、`/api/messages/history` 成员只能读本群
  （按 `group_member` 表）；无 `conv_id` 的全量与任意群读取限 group_admin
- SSE（`/api/events/stream`）接受 `?token=` 查询参数（EventSource 无法带 header）——
  仅限内网/反代场景使用，公网部署需换 fetch 流式方案
- 私信（ai_dm）只能看自己的；member 显式查他人 sender_id → 403；admin 可查他人
- LLM 燃烧端点（`/api/mine/run`、`/api/minutes/generate`）仅 group_admin
- 审计：confirm/reject/complete 均记录真实操作人（session user id）

## 7b. 可选：Jev 决策门（降 LLM 成本与漏判）

`IMAI_LLM_GATE=jev` 开启后，每条群消息先过一次 Jev（TypeSafe System One，~250ms）：

- `IMAI_JEV_MODE=shadow`（默认）：只把“Jev 概率 vs StepFun 判定”写入审计（actor=`gate`），
  不拦截流量——先跑一周看 `agree` 率再决定
- `IMAI_JEV_MODE=enforce`：概率低于 `IMAI_JEV_THRESHOLD`（默认 0.45）直接跳过，不调 StepFun
- 口头完成的多候选匹配也改走 Jev Choice（治“无脑完成最近一条”）
- Jev 故障/未配 key 时自动回退全量 LLM 路径，可用性优先
- 50 条真实语料评测：门 FN=0 / acc=98%（StepFun 88%/FN=4），p50 245ms vs 3179ms

## 8. 备份

```bash
# 每日 pg_dump（替换旧 scripts/backup-db.ps1——内含作者个人路径，勿直接用）
pg_dump -U imai -h 127.0.0.1 imai | gzip > /backup/imai-$(date +%F).sql.gz
# 保留 14 天
find /backup -name 'imai-*.sql.gz' -mtime +14 -delete
```

## 9. LLM 预算

每条进管线的群消息都会过一次 LLM。50 人团队按日均 500 条估算，DeepSeek 月成本约几十元量级；
用 `/api/stats/quality`（登录可看）观测识别量与延迟。要控本：`IMAI_REMIND_INTERVAL_SEC`
保持默认、非必要不开 `remindToGroup`。

## 10. 已知边界（升级前请知悉）

- **单人项目**：bus factor = 1，无第二维护者；采纳前想清楚
- **PolyForm Noncommercial 许可**：内部办公/学习免费；**商业产品需作者授权**
- 桌面端（Electron）当前定位是作者本机开发壳；团队部署用浏览器即可，
  系统通知由渲染层经 IPC 转发，托盘未读角标暂为静态（原实现硬编码 user001 已移除）
- e2e 验收（`backend-ts/e2e`）需活服务 + 真实 LLM key，默认连 `imai_test` 库
