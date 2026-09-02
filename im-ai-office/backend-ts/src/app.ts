import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { config } from "./config.js";
import { initSchema } from "./db.js";
import { taskRoutes } from "./routes/tasks.js";
import { openimRoutes } from "./routes/openim.js";
import { rbacRoutes } from "./routes/rbac.js";
import { memoryRoutes } from "./routes/memory.js";
import { miscRoutes } from "./routes/misc.js";
import { extraRoutes } from "./routes/extra.js";
import { handleOpenimCallback } from "./callback.js";
import { checkCallbackToken } from "./deps.js";

// ============ 应用组装（app.py + imai/api/__init__.py 的 TS 版） ============
// 评审 B：必须链式合并并使用返回值——语句式 app.route() 的 typeof 不含路由类型

const callbackHandler = async (c: import("hono").Context): Promise<Response> => {
  const denied = checkCallbackToken(c);
  if (denied) return c.json(denied) as unknown as Response;
  const payload = await c.req.json().catch((): null => null);
  if (!payload) return c.json({ ok: false, error: "invalid json" }) as unknown as Response;
  return c.json(await handleOpenimCallback(payload)) as unknown as Response;
};

export const app = new Hono()
  // CORS 白名单（对齐 deps.allowed_origins；前端 API_BASE 是绝对地址，页面在 localhost 时为跨源）
  .use("*", cors({
    origin: ["tauri://localhost", "https://tauri.localhost", "http://localhost:1420",
             "http://127.0.0.1:8000", "http://localhost:8000"],
    allowHeaders: ["Content-Type", "X-IMAI-Admin-Token", "X-IMAI-Token"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }))
  // OpenIM 回调（唯一落库+AI 入口）：/callback 与 /callback/{command}（OpenIM 会把命令名追加到 URL）
  .post("/callback", callbackHandler)
  .post("/callback/:command", callbackHandler)
  .route("/", taskRoutes)
  .route("/", openimRoutes)
  .route("/", rbacRoutes)
  .route("/", memoryRoutes)
  .route("/", miscRoutes)
  .route("/", extraRoutes)
  // 静态前端（web/ 目录；API 路由优先于静态）
  .use("*", serveStatic({ root: "../web", rewriteRequestPath: (p) => p }))
  .get("/", serveStatic({ path: "../web/index.html" }));

// Hono RPC 契约类型（前端 hc<AppType> 用）
export type AppType = typeof app;

// 测试环境仍可导入 app（不启动端口）
