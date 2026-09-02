import dotenv from "dotenv";
import path from "node:path";

// 加载仓库根 .env（与 Python 版共用同一份环境变量名）
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env.local"), override: true });

const env = (k: string, d = "") => process.env[k] ?? d;

export const config = {
  port: parseInt(env("IMAI_TS_PORT", env("PORT", "8000")), 10),
  databaseUrl: env("DATABASE_URL", "postgres://imai:openIM123@127.0.0.1:5432/imai"),
  // LLM（与 Python 版同名 env）
  llmBase: env("LLM_BASE", "https://api.deepseek.com/v1"),
  llmApiKey: env("LLM_API_KEY", ""),
  llmModel: env("LLM_MODEL", "deepseek-chat"),
  llmRetries: parseInt(env("IMAI_LLM_RETRIES", "2"), 10),
  // OpenIM
  openimApi: env("OPENIM_API", "http://127.0.0.1:10002"),
  openimAdminToken: env("OPENIM_ADMIN_TOKEN", ""),
  openimSecret: env("OPENIM_SECRET", "openIM123"),
  authToken: env("AUTH_TOKEN", ""),
  // 三方校验（deps 哲学：env 未设置=放行+一次性 WARN）
  adminToken: env("IMAI_ADMIN_TOKEN", ""),
  loginPassword: env("IMAI_LOGIN_PASSWORD", ""),
  // 提醒调度（0=关闭）
  remindIntervalSec: parseInt(env("IMAI_REMIND_INTERVAL_SEC", "60"), 10),
  remindToGroup: env("IMAI_REMIND_TO_GROUP", "0") === "1",
  digestTime: env("IMAI_DIGEST_TIME", "18:00"),
  digestFallbackAdmin: env("IMAI_DIGEST_ADMIN", "user001"),
  // 确定性 msgId 去重窗口（秒）
  dedupWindowSec: parseInt(env("IMAI_DEDUP_WINDOW_SEC", "1800"), 10),
  webDir: path.resolve(import.meta.dirname, "../web"),
};

export const HIGH_RISK_ACTIONS = new Set(["assign_notify", "dm_send", "delete_task", "broadcast"]);
export const UNRESOLVED_STATUS = ["pending_assignee", "pending_confirmation"] as const;

const warned = new Set();
export function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.log(`[auth] WARN ${message}`);
}
