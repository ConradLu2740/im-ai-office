// 哨兵测试（评审要求）：证明 Hono RPC 契约的编译期类型约束真实生效。
// 本文件由 `npx tsc --noEmit` 检查：若后端契约类型丢失（如改回语句式注册），
// 下面的 @ts-expect-error 将变成「未使用的 @ts-expect-error」→ 编译失败，哨兵报警。
//
// 说明：
// 1. 后端以 app.route("/") + handler 内全路径注册，hc 路由键为路径分段
//    （client.openim.send_message），不是 client["/openim/send_message"]。
// 2. 字段级检查（拼错 json 字段报错）需后端路由挂 zValidator 定义输入 schema；
//    当前 handler 用 c.req.json()（input 类型为空 → json 宽松）。
//    P3 重写 /api/messages/send 时随契约类型化收紧，届时把哨兵 1 换回字段级。
import { hc } from "hono/client";
import type { AppType } from "../../../backend-ts/src/app";

const client = hc<AppType>("http://127.0.0.1:8000");

// 正例：正确契约应通过（若此行报错说明类型推导断裂）
export const okCall = client.openim.send_message.$post({
  json: { user_id: "user001", group_id: "1591442033", text: "hi", client_msg_id: "c-1" },
});

// 哨兵 1（方法级）：/api/roles 只有 GET，$post 必须编译失败
// @ts-expect-error GET-only 端点不允许 $post，必须编译失败
client.api.roles.$post({ json: {} });

// 哨兵 2（端点级）：不存在的端点必须编译失败
// @ts-expect-error 不存在的端点
client.openim.not_exist_endpoint.$post({ json: {} });

export {};
