# OpenIM 实时消息链路修复 Spec

> 编写时间：2026-08-24 14:15（GMT+8）
> 状态：✅ 已实施并验收通过（2026-08-24 14:31）
> 关联：`交接复盘.md` §3/§4、`完整办公IM接入Spec.md`、`OpenIM群聊接入Spec.md`

---

## 1. 背景与现象

双击 .app（IMAI办公助手）后 GUI、后端、本地闭环均正常，但**实时群消息收不到**：

- 网关 `/gw/ping` 返回 `{"ok":true,"connected":false}`
- 网关日志报 `errCode 1507, errMsg TokenNotExistError` + `OnUserTokenInvalid`
- 尝试用新 token 重新登录网关时，**网关进程直接崩溃退出**（8400 无监听）

## 2. 调研结论（已实测验证）

### 2.1 OpenIM 服务端本身健康
- Colima VM 内 `openim-server` 状态 `healthy`，端口 10001(WS)/10002(API) 经 ssh 隧道正常暴露
- 实测 `POST /auth/get_user_token`（admin token + secret）**成功**为 user001 签发新 token：
  - `errCode: 0`，`expireTimeSeconds: 7776000`（90 天）
- **OpenIM 服务端无需任何改动**

### 2.2 根因链（三层）

| 层 | 根因 | 证据 |
|---|---|---|
| ① 触发 | **OpenIM server 于 2026-08-23 14:59 重启**，用户 token 记录（存于 redis）丢失 → 网关持有的旧 token 全部失效 | `docker inspect openim-server` StartedAt=2026-08-23T06:59Z；1507 TokenNotExistError |
| ② 崩溃 | **SDK v3.8.3-patch.1 的 `getSDK()` Proxy 调试包装器 bug**：`login()` resolve 的是数字/undefined（`t3.loginStatus`），而包装器 `.then(e3 => e3.errCode)` 假设 `{errCode,data}` 结构 → TypeError → unhandled rejection → Node 进程退出 | bundle 7460 行崩溃堆栈；5906-5929 行 login 实现 |
| ③ 结构 | 网关登录**依赖前端手动触发**（前端登录 → 后端换 token → `/gw/login`），无自动登录/重连/防崩；token 无自动续期；`.env` 未显式配置 `OPENIM_SECRET` | `msg_gateway.bundle.cjs` /gw/login 逻辑；`.env` 缺 OPENIM_SECRET |

> 补充解释：旧 token 登录走 reject 路径（不走 `.then`）所以网关不崩只报错；**有效新 token 登录走 resolve 路径，触发包装器崩溃** —— 这就是「token 失效 → 一旦重新登录网关就崩」的直接原因。

### 2.3 相关代码位置
- 网关：`desktop/src/msg_gateway.bundle.cjs`（webpack 打包产物，SDK 内联，入口在 7471 行注释 `// msg_gateway.cjs`）
- 后端登录换 token：`app.py` `/openim/login`（`_openim_post("/auth/get_user_token")`）
- 后端消息入口（两条）：`/callback`（OpenIM webhook）、`/api/sdk_message`（网关 SDK 推送）
- 前端登录流：`desktop/src/index.html` `doLogin()` → `initSDK()` → `/gw/login`

## 3. 修复目标

1. 网关**进程常驻**：任何登录/连接异常只记录日志，不退出
2. 网关**能用有效 token 连上** OpenIM（`/gw/ping connected=true`）
3. **双击 .app 即自动在线**：无需手动点登录
4. token 失效后可自动恢复（重登或提示），不再需要人工排查
5. 不破坏现有本地闭环（回归 PASS 14/0）

## 4. 方案设计

### 4.1 网关健壮性修复（核心，`desktop/src/msg_gateway.bundle.cjs`）

1. **`/gw/login` 不再 `await sdk.login()`**：
   ```js
   sdk.login({ userID: uid, token, platformID: 5, wsAddr: WS_ADDR, apiAddr: API_ADDR })
     .catch((e) => console.log("[gw] login promise rejected(ignored):", e?.message || e));
   ```
   - 连接结果由已注册的 `OnConnectSuccess` / `OnConnectFailed` 事件驱动（现有 `connected` 变量即反映真实状态）
   - 包装 promise 的 rejection 被显式吞掉，避免 unhandled rejection 崩溃

2. **进程级兜底**（网关是常驻进程，绝不允许因单个异常退出）：
   ```js
   process.on("unhandledRejection", (e) => console.log("[gw] unhandledRejection:", e?.message || e));
   process.on("uncaughtException", (e) => console.log("[gw] uncaughtException:", e?.message || e));
   ```

3. **`/gw/login` 返回与真实状态一致**：登录后不立即返回成功，等待 1-2s 事件回调，`ok` 由 `connected` 决定（或保持立即返回但由 `/gw/ping` 反映真实状态，二选一；建议立即返回 + 前端轮询 ping）

### 4.2 自动连接（后端启动即在线）

在 `app.py` 增加 startup 钩子（或 `cli.py up` 内调用）：

```
启动后端 → 用 OPENIM_SECRET + OPENIM_ADMIN_TOKEN 调 /auth/get_user_token 换 user001 token
        → POST http://127.0.0.1:8400/gw/login {userID: user001, token}
        → 轮询 /gw/ping 直到 connected（超时 10s 记日志不阻塞启动）
```

- 效果：双击 .app（Tauri setup 自动 start_backend）→ 后端起来 → 网关自动登录 → 实时在线
- 用户在前端再登录只是切换身份/会话，不阻塞

### 4.3 配置显式化（`.env`）

```bash
# 新增（当前缺省依赖 openIM123 恰好可用，但应显式声明）
OPENIM_SECRET=openIM123
# 网关自动登录用哪个账号（默认 user001）
GW_LOGIN_USER=user001
```

### 4.4 后续项（本期不做，记录待办）
- **SDK 升级**：将 openim SDK 升级到修复版并重新 webpack 打包 bundle + 重建 .app（工作量大，需 node_modules/webpack 环境；当前 patch 方案已规避）
- **网关 token 自动续期**：由网关用 OPENIM_SECRET 自行换 token（需要把 secret 传入网关，安全权衡后决定）
- **前端「重连」按钮** + 登录失败时明确提示「OpenIM 服务端重启过，请重新登录」

## 5. 改动清单

| 文件 | 改动 | 风险 |
|---|---|---|
| `desktop/src/msg_gateway.bundle.cjs` | /gw/login 防崩 + 进程兜底（约 10 行） | 低；改后需同步到 .app backend 资源（重建 .app 或手动拷贝） |
| `app.py` | startup 自动登录网关（约 20 行） | 低；失败仅记日志 |
| `.env` | 增加 `OPENIM_SECRET`、`GW_LOGIN_USER` | 低 |
| `.env.example` | 同步新增两项 | 低 |
| `desktop/src-tauri/src/lib.rs` | 无需改动（自动 start_backend 已有） | - |
| `.app` | 重新构建（含新 bundle + app.py） | 中（构建耗时） |

## 6. 验收标准

```bash
# 1. 网关进程稳定
node desktop/src/msg_gateway.bundle.cjs &   # 或重启后端自动拉起
sleep 3
ps aux | grep msg_gateway                    # 进程存活

# 2. 登录后 connected=true
curl -s http://127.0.0.1:8400/gw/ping        # {"ok":true,"connected":true}

# 3. 后端启动自动登录（不手动操作）
python3 app.py
curl -s http://127.0.0.1:8400/gw/ping        # connected=true（10s 内）

# 4. 真实消息可达
#   在 OpenIM 发一条群消息 → 网关日志出现 "[gw] recv msg:" → 后端 /api/sdk_message 入账

# 5. 回归不破坏
python3 test_flow.py                          # PASS 14 / FAIL 0
```

## 7. 实施步骤（评审通过后执行）

1. 备份 `desktop/src/msg_gateway.bundle.cjs`（git 或 cp 副本）
2. patch 网关（4.1 三处）
3. patch `app.py` startup 自动登录（4.2）
4. 更新 `.env` / `.env.example`（4.3）
5. 重启网关 + 后端，按 §6 验收 1-5
6. 重建 .app 并复制新 bundle/后端资源，双击验证
7. 更新 `交接复盘.md` §5 下一步建议（标记完成项）
