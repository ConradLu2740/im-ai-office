# IMAI · UX 债项清理 Spec（迭代 2.6）

时间：2026-08-29 ｜ 前置：GUI 全链路验证通过 ｜ 用户选定路线 A（清 UX 债项），D3 调优一并纳入

## UX-1 过期 token 静默重签

**现状**：localStorage 里的 token 被 OpenIM 侧顶掉/过期后，前端任何请求返回
`{ok:false, error:"...token..."}`，`loadConversations` 等弹**模态 alert** 冻结页面
（8/29 上午"假死"根因）。

**修复**（app.js）：
1. `ensureToken()`：静默 POST /openim/login（password-less）重签，成功则更新
   currentToken + localStorage；并发场景用单飞 promise 防重放
2. `api()` 检测响应 `ok===false` 且 error 匹配 /token|auth/i → 重签后**重试原请求一次**
   （`_retried` 参数防循环）；重签也失败 → 回登录页（logout）
3. 已知限制：若未来设置 IMAI_LOGIN_PASSWORD，静默重签不可用，回登录页要求输入

验收：手工把 localStorage token 改成垃圾值 → 刷新 → 自动恢复登录态且数据正常加载，无弹窗。

## UX-2 alert 全量改 toast

1. 新增 `showToast(msg, ok=true)`：右上偏中轻提示，2.2s 自动消失，成功绿/失败红
2. 替换 app.js 全部 `alert(...)`（doLogin/sendMsg/sendSim/loadConversations/
   confirmTask 间接/approve/reject/resolve 回复等），确认/驳回成功提示绿色

验收：grep 无 alert( 残留；页面无阻塞弹窗。

## UX-3 时间戳美化 + 会话真名

1. `fmtTime(ts)`：今天 → `HH:MM`；昨天 → `昨天 HH:MM`；更早 → `MM-DD HH:MM`；
   解析失败回退原串截断
2. 应用：loadAIMessages（m.ts）、loadMessageHistory（m.ts）、renderGWMessage（sendTime）
3. 会话真名：renderConversations（REST 路径）与 SDK 路径对齐，
   `name = c.showName || (c.groupID ? 群+ID : c.userID)`——OpenIM 会话响应自带 showName

验收：浏览器预览看 AI 助手消息时间为人话；单聊会话显示真名。

## UX-4 D3 隐含指派 prompt 调优

**现状**：eval D3「库存报表还没人做呢」期望 is_task=true，实际 false（漏判）——
prompt 只覆盖显式指派/认领。

**修复**：pipeline.py intent_detect system prompt 增补一条规则：
「『XX 还没人做』『还没人负责』『这个得有人跟』等指出具体工作无人认领的表达，
同样是任务（is_task=true，assign_mode=none，后续归属判定处理）」

**验收**：真实 LLM eval 全量 22 样本 ≥ 21 通过（D3 通过 + 其余不回归）；
不回归验证 = 既有 20 个通过样本保持通过（尤其 reject 类负例不误报）。
迭代上限 3 轮 prompt 修改；3 轮不达标则记录后停止，不硬凑。

## 非目标

- confirmTask 的 alert 属 UX-2 范围；其余面板布局打磨不做
- async 默认值翻转不做

## 归档

每项独立 commit；全部完成后台 guard 全量回归 + 重建安装 + 记忆更新。
