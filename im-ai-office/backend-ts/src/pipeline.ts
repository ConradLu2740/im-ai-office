import { z } from "zod";
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "./db/drizzle.js";
import { TASK_COLS, auditLog, distinctAliasNames, findPersonsByAlias, insertTask, type TaskRow } from "./repos.js";
import { task as taskT } from "./db/schema.js";
import { getLlm } from "./llm.js";
import { buildSysCtx } from "./memory.js";
import { fanout } from "./sse.js";

// ============ AI 编排管线（pipeline.py 的 TS 版）：意图判定 → 归属判定 → 落库 ============

const INTENT_SCHEMA = {
  is_task: "boolean", confidence: "high|medium|low",
  content: "string", assignee_hint: "string|nullable(用'我'表示说话人)",
  deadline_hint: "string|nullable", assign_mode: "assigned|self|third_party|none",
  is_completion: "boolean(消息表示某事已做完时 true，否则 false)",
};

const INTENT_SYSTEM =
  "你是办公群聊里的任务识别助手。只在消息确实安排/认领任务时 is_task=true。" +
  "分清：明确指派(@某人或'你负责')=assigned；主动认领('我来')=self；第三人称指派('让小张跟一下')=third_party；无归属=none。" +
  "指出某项具体工作还没人做/没人负责（如'XX还没人做呢'）也是待认领任务：is_task=true、assign_mode=none。" +
  "消息表示某件事/任务已经做完（如'做完了''搞定了''XX已交付'）时：is_task=false、is_completion=true、content=完成的事项；" +
  "纯抱怨或闲聊不是任务；明确否认（'这不是任务'）时 is_task=false。不要臆断。输出严格JSON：" +
  JSON.stringify(INTENT_SCHEMA);

// Zod：LLM 输出容错（is_task 偶发字符串 "true"/"false"，同 Python to_bool）
const toBool = (v: unknown): boolean =>
  typeof v === "boolean" ? v : String(v ?? "").trim().toLowerCase() === "true";

const IntentZ = z.object({
  is_task: z.any().transform(toBool),
  confidence: z.string().default("low"),
  content: z.string().nullable().optional(),
  assignee_hint: z.string().nullable().optional(),
  deadline_hint: z.string().nullable().optional(),
  assign_mode: z.string().default("none"),
  is_completion: z.any().transform(toBool).optional(),
});
export type Intent = z.infer<typeof IntentZ>;

export async function intentDetect(msg: string, sysCtx = ""): Promise<Intent> {
  let system = INTENT_SYSTEM;
  if (sysCtx) system += "\n" + sysCtx;
  const raw = await getLlm()(system, "判断这条群聊消息是否在安排任务；是则提取内容/负责人/截止：\n消息：" + msg);
  try {
    return IntentZ.parse(JSON.parse(raw));
  } catch {
    return { is_task: false, confidence: "low", content: null, assignee_hint: null,
             deadline_hint: null, assign_mode: "none", is_completion: false };
  }
}

// ============ 归属判定（别名消歧 + 认领模式） ============

export interface AssignResult {
  assignee: string | null; confidence: string;
  candidates: Array<Record<string, unknown>>;
  mode: string; ambiguous: boolean; ambiguous_labels?: Array<{ person_id: number; label: string }>;
}

export async function resolve(msg: string, sender = "李娜(娜姐)", intent?: Partial<Intent>): Promise<AssignResult> {
  const mode = intent?.assign_mode ?? "none";
  if (mode === "self") {
    return { assignee: sender, confidence: "high", candidates: [], mode, ambiguous: false };
  }
  const names = await distinctAliasNames();
  const hits: PersonRow[] = [];
  const seen = new Set<number>();
  for (const n of names) {
    if (n && msg.includes(n)) {
      for (const p of await findPersonsByAlias(n)) {
        if (!seen.has(p.id)) { seen.add(p.id); hits.push(p); }
      }
    }
  }
  if (hits.length === 0) {
    const hint = intent?.assignee_hint ?? null;
    return { assignee: hint || null, confidence: "low", candidates: [], mode, ambiguous: false };
  }
  if (hits.length === 1) {
    const h = hits[0];
    return { assignee: `${h.real_name}/${h.flower_name ?? ""}`, confidence: "high", candidates: hits, mode, ambiguous: false };
  }
  return {
    assignee: null, confidence: "medium", candidates: hits, mode, ambiguous: true,
    ambiguous_labels: hits.map((r) => ({ person_id: r.id, label: `${r.real_name}(${r.flower_name ?? ""})` })),
  };
}
type PersonRow = { id: number; real_name: string | null; flower_name: string | null };

// ============ G1 口头完成（宁漏勿错） ============

export async function handleCompletion(msg: string, sender: string, contentHint?: string | null): Promise<TaskRow | null> {
  const s = (sender ?? "").trim();
  if (!s) return null;
  const tasks = await db.select(TASK_COLS).from(taskT)
    .where(and(eq(taskT.status, "confirmed"), like(taskT.assignee, `%${s}%`)))
    .orderBy(desc(taskT.id)) as unknown as TaskRow[];
  if (!tasks.length) return null;
  const hint = (contentHint ?? "").trim();
  let picked = null as TaskRow | null;
  if (hint) {
    for (const t of tasks) {
      if (hint.slice(0, 4) && (t.content ?? "").includes(hint.slice(0, 4))) { picked = t; break; }
    }
  }
  picked = picked ?? tasks[0];
  const { completeTask } = await import("./tasks.js");
  if (await completeTask(picked.id, `user:${s}`)) {
    fanout("task_completed", { taskId: picked.id, by: "chat" });
    return picked;
  }
  return null;
}

// ============ 主流程 ============

export interface ProcessResult {
  message: string; sender: string; intent: Intent;
  action: string; assign?: AssignResult;
  needs_confirmation?: boolean;
  task?: { taskId: number; content: string; assignee: string | null; deadline: string | null; status: string; candidates?: Array<{ person_id: number; label: string }> };
  completed_task?: { taskId: number; content: string };
}

export async function processMessage(msg: string, sender = "李娜(娜姐)", groupId?: string | null): Promise<ProcessResult> {
  const sysCtx = groupId ? await buildSysCtx(groupId) : "";
  const intent = await intentDetect(msg, sysCtx);
  const base: ProcessResult = { message: msg, sender, intent, action: "skip" };
  if (!intent.is_task) {
    // G1 口头完成：is_completion 命中 → 尝试标记对应任务 done（宁漏勿错）
    if (intent.is_completion) {
      const picked = await handleCompletion(msg, sender, intent.content ?? null);
      base.action = picked ? "task_completed" : "skip";
      if (picked) base.completed_task = { taskId: picked.id, content: picked.content };
      return base;
    }
    base.action = "skip"; // 非任务，静默
    return base;
  }

  const assign = await resolve(msg, sender, intent);
  base.assign = assign;

  if (assign.ambiguous) {
    // 有歧义 → 落库 pending_assignee，再私聊发送者确认
    const content = intent.content || msg;
    const deadline = intent.deadline_hint ?? null;
    const pendingMeta = JSON.stringify({ candidates: assign.ambiguous_labels ?? [] });
    const taskId = await insertTask(content, sender, null, deadline, "pending_assignee",
      intent.confidence, msg, pendingMeta);
    await auditLog("ai", "identify_ambiguous",
      { taskId, content, candidates: assign.ambiguous_labels ?? [] });
    base.action = "confirm_assignee";
    base.needs_confirmation = true;
    base.task = { taskId, content, assignee: null, deadline, status: "pending_assignee", candidates: assign.ambiguous_labels ?? [] };
    return base;
  }

  const assignee = assign.assignee || "待指派";
  const content = intent.content || msg;
  const deadline = intent.deadline_hint ?? null;
  const taskId = await insertTask(content, sender, assignee, deadline, "pending_confirmation", intent.confidence, msg);
  await auditLog("ai", "task_created", { taskId, content, assignee, deadline });
  base.action = "task_created";
  base.task = { taskId, content, assignee, deadline, status: "pending_confirmation" };
  return base;
}

// ============ 审计（G9：sync 路径统一 ai_processed） ============

export async function auditAiProcessed(
  msgId: string | null, result: ProcessResult, content: string, source: string, latencyMs: number
): Promise<void> {
  await auditLog("api", "ai_processed", {
    msgId, action: result.action,
    taskId: result.task?.taskId ?? null,
    content: (content || "").slice(0, 60),
    latency_ms: Math.round(latencyMs),
    source,
  });
}

