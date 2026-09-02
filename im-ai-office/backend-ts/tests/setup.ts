import { beforeEach, afterEach } from "vitest";
import { pool, wipeAndSeed } from "../src/db.js";
import { setLlmImpl, type LlmFn } from "../src/llm.js";
import { setOpenimStub } from "../src/openim.js";

// 测试基座（conftest.py 的 TS 版）：每次用例全新种子库 + fake LLM + OpenIM stub

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

beforeEach(async () => {
  await wipeAndSeed();
  setOpenimStub({ sent_group: [], sent_private: [] });
});

afterEach(async () => {
  setLlmImpl(null);
  setOpenimStub(null);
  const { setOpenimPost } = await import("../src/openim.js");
  setOpenimPost(null);
});

export { pool };
