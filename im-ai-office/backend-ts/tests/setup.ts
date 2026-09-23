import { beforeEach, afterEach } from "vitest";
import { pool, wipeAndSeed, query } from "../src/db.js";
import { setLlmImpl, type LlmFn } from "../src/llm.js";

// 测试基座（conftest.py 的 TS 版）：每次用例全新种子库 + fake LLM
// （P3：OpenIM stub 随 openim.ts 删除而退役；LLM 注入不变）

export function makeIntent(o: Record<string, unknown> = {}): Record<string, unknown> {
  return { is_task: true, confidence: "high", content: null, assignee_hint: null,
    deadline_hint: null, assign_mode: "self", is_completion: false, ...o };
}

export function makeFakeLlm(routes: Array<{ match: RegExp | string; intent: Record<string, unknown> }>): void {
  const fn: LlmFn = async (_system, user) => {
    const hit = routes.find((r) => (typeof r.match === "string" ? user.includes(r.match) : r.match.test(user)));
    if (!hit) return JSON.stringify(makeIntent({ is_task: false, confidence: "low", is_completion: false }));
    return JSON.stringify(hit.intent);
  };
  setLlmImpl(fn);
}

/** 直插用户 + 会话（端点鉴权用），返回 Bearer token */
export async function mkSession(userId: string, displayName = "测试用户"): Promise<string> {
  const { randomBytes, scryptSync } = await import("node:crypto");
  const token = randomBytes(32).toString("hex");
  const passwordHash = `${randomBytes(16).toString("hex")}:${scryptSync("x", "s", 64).toString("hex")}`;
  await query(
    "INSERT INTO app_user(id, username, display_name, password_hash) VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
    [userId, `u-${userId}`, displayName, passwordHash]);
  await query("INSERT INTO session(token, user_id, expires_at) VALUES($1,$2, NOW() + INTERVAL '1 day')", [token, userId]);
  return token;
}

beforeEach(async () => {
  await wipeAndSeed();
});

afterEach(async () => {
  setLlmImpl(null);
});

export { pool };
