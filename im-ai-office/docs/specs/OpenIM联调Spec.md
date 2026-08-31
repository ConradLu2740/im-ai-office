# OpenIM 联调 Spec

> 目标：把**真实 OpenIM 群聊**接入我们「对话式 AI 办公」的完整闭环，用真实群消息触发任务识别/消歧/落库/回写。
> 日期：2026-08-22 ｜ 关联：`技术设计文档.md` 第 9 节、`im-ai-office/` 骨架

---

## 0. 现状与已验证结论

- ✅ OpenIM 服务端已在本机 docker（colima 6GB）跑起来：openim-server(healthy)/chat/mongo/redis/etcd/kafka/minio 7 容器 Up
- ✅ 端口：server API `10002`、chat `10008`、admin `10009`、etcd `12379`、minio `10005`
- ✅ 关键 secret：OpenIM `openIM123`、chat register secret `23ztfSqsfQ8hKkHzHTl3Z4bvaxro0snjk5jwbp5p6Q3`、superCode `666666`、adminUserID `imAdmin`
- ✅ **admin token 已取得**：`POST /auth/get_admin_token {secret, userID}` → errCode 0（这是正确接口，非 `/auth/user_token`）
- ✅ **注册用户接口 body 是嵌套结构**：`{ "user":{...}, "verifyCode":"666666", "platform":N }`（ArgsError 根因是之前用扁平结构）

> 我方闭环已可用：`oim-webhook`(8100) + `ai-agent`(消费 Redis) + `board-api`(8300) + `reminder` + Postgres。LLM 用 Proma Cloud 云端。

---

## 1. 联调架构与数据流

```
[OpenIM 群] --发群消息--> [openim-server]
                            │ Webhook 回调(*配置*)
                            ▼
                        oim-webhook(8100)  ← HTTP POST 回调目标
                            │ 解析 → XADD
                            ▼
                      Redis Streams(msg)
                            │
                            ▼
                   ai-agent(识别/消歧/落库 Postgres)
                            │
                            ▼  回写(群确认卡/私聊消歧)
                   OpenIM `/msg/send_msg` REST
```

两个方向：
- **流入**：OpenIM 群消息 → Webhook 回调 → oim-webhook → Redis → ai-agent（识别→消歧→落库）
- **回写**：ai-agent → OpenIM REST `send_msg`（群确认卡 `sessionType=3` / 私聊消歧 `sessionType=1`）

---

## 2. OpenIM 所需配置（服务端侧）

| 项 | 值 | 位置 |
|---|---|---|
| adminUserID | `imAdmin` | share.yml（已配） |
| secret | `openIM123` | share.yml（已配） |
| chat register secret | `23ztfSqsfQ8hKkHzHTl3Z4bvaxro0snjk5jwbp5p6Q3` | chat-rpc-chat.yml（已配） |
| superCode | `666666` | chat-rpc-chat.yml（已配） |
| **回调 URL** | `http://<host>:8100/callback`（指向 oim-webhook） | **待配置** |
| 回调开关 | 开启消息事件（afterSendGroupMsg 等） | **待配置** |

> 回调配置在 OpenIM server 的 config（`openim-server/config/*.yaml` 或环境变量）中设置 `callbackUrl` 并开启对应协议开关。此步需要在 openim-server 部署配置里改，或通过环境变量注入。**这是联调最关键的"接通"步骤。**

---

## 3. OpenIM REST API 清单（我方侧调用）

所有请求需 header `operationID`；管理类接口还需 header `token`（= admin token）。

| 用途 | 方法/路径 | 关键参数 | 说明 |
|---|---|---|---|
| 拿 admin token | `POST /auth/get_admin_token` | body `{secret:"openIM123", userID:"imAdmin"}` | ✅ 已验证 errCode=0 |
| 注册用户 | `POST /account/register`（chat 10008） | body `{user:{userID?,phoneNumber,areaCode,nickname,password}, verifyCode:"666666", platform:N}` | 嵌套 user |
| 获取用户 token | `POST /auth/user_token` | body `{secret, platform, userID}` | 需用户已存在 |
| 创建群 | `POST /group/create_group` | header token; body(群信息+成员) | admin/用户 token |
| 群内发消息 | `POST /msg/send_msg` | body `{sendID, groupID, content:{content}, contentType:101, sessionType:3}` | 我方回写用 |
| 私聊发消息 | `POST /msg/send_msg` | `{sessionType:1, recvID}` | 私聊消歧用 |
| 回调（server→我方） | HTTP POST → `oim-webhook/callback` | OpenIM 下发 msgID/groupID/sendID/content | **流入** |

---

## 4. 我方侧待确认/待补

- `services/oim-webhook/main.py`：已写字段兼容（msgID/groupID/sendID/content），**待联调核对真实回调体**
- `services/ai-agent/openim_client.py`：已封装 `send_group_notice()`/`send_private_confirm()`，**需配环境变量 `OPENIM_API`/`OPENIM_ADMIN_TOKEN`**
- `services/ai-agent/main.py`：消费 Redis→识别→落库已通；**回写群消息的逻辑待补**（当前占位）
- `.env`：补 `OPENIM_API=http://localhost:10002`、`OPENIM_ADMIN_TOKEN=<admin token>`

---

## 5. 端到端联调步骤（顺序）

1. **配置 OpenIM 回调**：把回调 URL 指向 `oim-webhook`，开启消息事件回调（server 侧）
2. **重启/确认 oim-webhook**：确保 8100 可接收（curl 自测 `/callback`）
3. **注册 2-3 个用户**（register，含张伟/张敏 制造"两个小张"，及李娜）：嵌套 user body + verifyCode=666666
4. **建群**（create_group，拉入上面用户）
5. **发一条真实群消息**（用用户 token 或 admin 调 send_msg）如"小张 你来跟进，周五前给我"
6. **验证流入**：openim-server 回调 → oim-webhook → Redis → ai-agent 日志出现识别/消歧/落库
7. **验证回写**：ai-agent 判定后调 OpenIM send_msg 发确认卡/私聊消歧，确认群里出现 AI 消息
8. **验证落库**：board-api `/tasks` 能查到任务

---

## 6. 验收标准（跑通 = 全部满足）

- [ ] OpenIM 真实群消息触发回调，oim-webhook 收到
- [ ] ai-agent 识别该消息，属主判定正确（"两个小张"触发消歧）
- [ ] 任务落库 Postgres，board-api 可查
- [ ] AI 通过 OpenIM 回写（群确认卡或私聊消歧确认），OpenIM 可见
- [ ] 全程可追溯（audit）

---

## 7. 风险与待解

| 风险 | 说明 |
|---|---|
| **回调配置是最大变数** | OpenIM 回调 URL/config 注入方式需按其部署文档确认（可能需改 openim-server 启动参数或 config.yaml） |
| register 细节 | user 对象字段（userID 自动生成还是必填）需实测；platform 值 | 
| 发送消息鉴权 | 群发消息需调用方有 token（AI 用 admin token 或指定 sendID 权限） |
| 内存 | OpenIM(6GB) + 我方栈 已同机，需观察是否吃紧 |

---

## 8. 执行状态与移交（2026-08-22）

### ✅ 已在本地验证完成
- OpenIM 服务端部署并健康（7 容器，openim-server healthy）
- admin token：`POST /auth/get_admin_token`（非 user_token），secret=`openIM123`、userID=`imAdmin`
- 回调配置：`webhooks.yml` url→`http://host.docker.internal:8100/callback`、`afterSendGroupMsg.enable=true` 已生效
- oim-webhook 鉴权放宽（OpenIM 回调不自定义签名头）
- 用户注册成功（嵌套 user body + verifyCode=666666）；**userID 为 OpenIM 随机数字 ID，非手机号**
- 真实 userID：李娜=`7951388786`、张伟=`5066421560`、张敏=`1117628237`

### ⚠️ 移交正式环境部分
- **建群 create_group**：本机多次 ArgsError（OpenIM 3.8 参数需按官方 SDK/文档精确 schema），**移交正式环境用官方 SDK 调**
- 发消息 send_msg、验证回调链路：待建群成功后执行

### 🔑 正式环境联调要点（已摸清，直接可用）
1. 用 `/auth/get_admin_token` 拿 admin token（`{secret:openIM123, userID:imAdmin}` + operationID 头）
2. 注册用户用**嵌套 body** `{user:{phoneNumber,areaCode,nickname,password}, verifyCode:"666666", platform}`；userID 自动生成
3. 建群需用**真实 userID**（非手机号），推荐用官方 SDK 一次性传对
4. 回调用 `host.docker.internal:8100/callback`（或正式环境对应地址）
5. 回调鉴权：本机已放行；正式环境应配 OpenIM 回调签名

---

*OpenIM 联调 Spec v1 · 2026-08-22 · 建群/发消息移交正式环境，其余前置已验证*
