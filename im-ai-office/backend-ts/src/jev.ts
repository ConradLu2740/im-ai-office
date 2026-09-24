import { config } from "./config.js";

// ============ Jev（TypeSafe System One）决策客户端 ============
// 与 llm.ts 同构：一个注入点 setJevImpl，测试假实现全项目生效。
// Jev 不生成文本：state + 类型化问题进，带概率的类型答案出（Noul 是/否、Choice 多选）。
// 定位：LLM 栈里"判断"环节的替代品——门、分类、匹配；提取/生成仍归 StepFun。

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria: Record<string, string> }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export interface JevAnswers {
  needs_attention?: { noul?: number };
  assign_mode?: { choice?: string; confidence?: number; probabilities?: Record<string, number> };
  completion?: { choice?: string; confidence?: number };
  [k: string]: unknown;
}

export type JevFn = (state: Record<string, unknown>, questions: Record<string, JevQuestion>) => Promise<JevAnswers>;

let impl: JevFn = defaultImpl;

export function getJev(): JevFn {
  return impl;
}

/** 测试注入点（对应 llm.ts 的 setLlmImpl）。 */
export function setJevImpl(fn: JevFn | null): void {
  impl = fn ?? defaultImpl;
}

async function defaultImpl(state: Record<string, unknown>, questions: Record<string, JevQuestion>): Promise<JevAnswers> {
  const res = await fetch(`${config.jevBase}/v1/systemone`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.jevKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.jevModel, state, questions }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}`);
  const data = (await res.json()) as { answers?: JevAnswers };
  return data.answers ?? {};
}

// ============ 门：一条消息要不要任务系统关注 + 归属方式（一次调用两问） ============

export const GATE_QUESTIONS: Record<string, JevQuestion> = {
  needs_attention: {
    type: "noul",
    instructions: "这条中文工作群消息是否需要任务管理系统关注？",
    criteria: {
      true: "安排、认领、催办某项具体工作（含指出某事没人负责），或报告某项工作已完成。",
      false: "闲聊、问候、寒暄，与具体工作安排无关的对话，或纯过去时态的协作同步。",
    },
  },
  assign_mode: {
    type: "choice",
    instructions: "这条消息里任务的归属方式是什么？",
    criteria: {
      assigned: "明确指派他人：@某人、'你负责'、'小明周五前交报告'。",
      self: "主动认领：'我来''我盯''我补一下'。",
      third_party: "第三人称指派：'让小张跟一下'。",
      none: "没有明确归属：指出某事没人做/没人接，或纯催办。",
    },
  },
};

export interface GateResult { attention: number; mode: string | null; ms: number }

/** 门判定；未启用/无 key/调用失败一律返回 null（调用方回退全量 LLM 路径，可用性优先）。 */
export async function jevGate(msg: string): Promise<GateResult | null> {
  if (config.jevGate !== "jev" || !config.jevKey) return null;
  const t0 = Date.now();
  try {
    const answers = await getJev()({ chat: "工作群聊", message: msg }, GATE_QUESTIONS);
    const attention = answers.needs_attention?.noul;
    if (typeof attention !== "number") return null;
    return { attention, mode: answers.assign_mode?.choice ?? null, ms: Date.now() - t0 };
  } catch {
    return null;
  }
}

// ============ 口头完成匹配：一条消息完成了哪条候选任务（Choice） ============

export interface CompletionCandidate { id: number; content: string; assignee: string | null }

/** 多候选时用 Jev Choice 匹配；返回任务 id、null（无匹配/未启用/失败）。 */
export async function jevPickCompletion(msg: string, sender: string, candidates: CompletionCandidate[]): Promise<number | null> {
  if (config.jevGate !== "jev" || !config.jevKey || candidates.length === 0) return null;
  const options: Record<string, string> = {
    none: "这条消息没有完成上面任何一条任务（可能只是闲聊或状态同步）。",
  };
  for (const c of candidates) options[`t${c.id}`] = `#${c.id} ${c.content}（负责人：${c.assignee ?? "待指派"}）`;
  try {
    const answers = await getJev()(
      { chat: "工作群聊", message: msg, speaker: sender, candidate_tasks: options },
      {
        completion: {
          type: "choice",
          instructions: "这条消息报告完成了哪条任务？",
          criteria: options,
        },
      },
    );
    const pick = answers.completion?.choice;
    if (!pick || pick === "none") return null;
    const id = Number(pick.replace(/^t/, ""));
    return Number.isInteger(id) && candidates.some((c) => c.id === id) ? id : null;
  } catch {
    return null;
  }
}
