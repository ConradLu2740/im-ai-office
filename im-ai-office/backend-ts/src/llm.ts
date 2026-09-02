import { config } from "./config.js";
import type { ZodType } from "zod";

// ============ LLM 唯一锚点（imai/llm.py 契约的 TS 版） ============
// 任何服务需要 LLM：import { getLlm } from "./llm.js"
// 测试注入假实现：setLlmImpl(fake)（一个注入点，全项目生效）

export type LlmFn = (system: string, user: string, opts?: { jsonMode?: boolean; maxTokens?: number }) => Promise<string>;

let impl: LlmFn = defaultImpl;

export function getLlm(): LlmFn {
  return impl;
}

/** 测试注入点（对应 monkeypatch imai.llm._impl）。 */
export function setLlmImpl(fn: LlmFn | null): void {
  impl = fn ?? defaultImpl;
}

const BACKOFF_BASE_SEC = 0.5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function defaultImpl(system: string, user: string, opts: { jsonMode?: boolean; maxTokens?: number } = {}): Promise<string> {
  const payload: Record<string, unknown> = {
    model: config.llmModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    // 2026-09-02：deepseek-v4-flash 变更为推理型输出（reasoning_content 计入 max_tokens），
    // 默认 1024 会被长推理耗尽 → content 为空。提升到 4096 保证正文有额度。
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.jsonMode !== false) payload["response_format"] = { type: "json_object" };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= config.llmRetries; attempt++) {
    if (attempt) await sleep(BACKOFF_BASE_SEC * 2 ** (attempt - 1) * 1000);
    try {
      const res = await fetch(`${config.llmBase}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.llmApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(40_000),
      });
      if (!res.ok) {
        if (res.status < 500 && res.status !== 408 && res.status !== 429) {
          throw new Error(`LLM HTTP ${res.status}`);   // 认证/参数类：不重试
        }
        lastErr = new Error(`LLM HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content || null;
      if (content !== null) return content;
      lastErr = new Error("LLM 空响应/响应结构异常");
    } catch (e) {
      if (e instanceof Error && /^LLM HTTP 4/.test(e.message)) throw e;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("LLM 调用失败");
}

// ============ Zod 结构化输出（instructor 模式：验证失败回喂重试） ============

/**
 * LLM → Zod 结构化解析：解析/验证失败时把错误信息拼回 user 消息重试。
 * schema 单一来源：Zod 模型同时生成 prompt 里的 JSON 形状说明，替代三处手写。
 */
export async function llmParse<T>(system: string, user: string, schema: ZodType<T>, opts: { maxRetries?: number; maxTokens?: number } = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  let lastUser = user;
  let lastErr = "";
  for (let i = 0; i <= maxRetries; i++) {
    const raw = await getLlm()(system, lastUser, { jsonMode: true, maxTokens: opts.maxTokens });
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      lastErr = "输出不是合法 JSON";
    }
    if (obj !== undefined) {
      const parsed = schema.safeParse(obj);
      if (parsed.success) return parsed.data;
      lastErr = parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
    }
    lastUser = `${user}\n\n【上次输出不合格：${lastErr}。请严格按 JSON 形状重新输出。】`;
  }
  throw new Error(`LLM 结构化解析失败：${lastErr}`);
}
