import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { config } from "./config.js";
import { initSchema } from "./db.js";
import { app } from "./app.js";
import { scanOnce } from "./reminder.js";
import { scanAndPush } from "./digest.js";

// ============ 提醒调度 + 每日汇总兜底（scheduler.py 的 TS 版；REMIND_INTERVAL_SEC=0 关闭） ============

let schedulerRunning = false;
function startScheduler(): boolean {
  if (schedulerRunning || config.remindIntervalSec <= 0) return false;
  schedulerRunning = true;
  const loop = async () => {
    while (schedulerRunning) {
      try {
        const summary = await scanOnce();
        if (summary.sent.length) {
          console.log(`[scheduler] 发送提醒 ${summary.sent.length} 条: ${
            summary.sent.map((s) => [s.taskId, s.tier])}`);
        }
        const d = await scanAndPush();
        if (d.pushed) console.log(`[scheduler] 每日汇总已推送 ${d.count} 条待确认 → ${d.to}`);
      } catch (e) {
        console.log(`[scheduler] 本轮扫描异常(下轮继续): ${e}`);
      }
      await new Promise((r) => setTimeout(r, config.remindIntervalSec * 1000));
    }
  };
  void loop();
  return true;
}

// ============ 启动 ============

const server = serve({ fetch: app.fetch, port: config.port }, async (info) => {
  console.log(`[imai-ts] 后端已启动 http://127.0.0.1:${info.port}`);
  await initSchema();
  startScheduler();
  console.log(`[imai-ts] PG 已就绪；提醒调度 ${config.remindIntervalSec > 0 ? `已启动 (interval=${config.remindIntervalSec}s)` : "未启动"}`);
});

process.on("SIGINT", () => {
  schedulerRunning = false;
  server.close(() => process.exit(0));
});
