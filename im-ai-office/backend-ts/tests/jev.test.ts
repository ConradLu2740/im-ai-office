import { describe, it, expect, afterEach } from "vitest";
import "./setup.js";
import { query, one } from "../src/db.js";
import { config } from "../src/config.js";
import { setJevImpl } from "../src/jev.js";
import { setLlmImpl } from "../src/llm.js";
import { makeIntent } from "./setup.js";
import { handleCompletion, processMessage } from "../src/pipeline.js";

// Jev（System One）门 + 口头完成匹配。
// 规格来源：scripts/jev-eval.mts 的 50 条真实语料评测（阈值 0.5 两侧干净分离，取 0.45 起步）。

const saved = { jevGate: config.jevGate, jevMode: config.jevMode, jevKey: config.jevKey, jevThreshold: config.jevThreshold };
afterEach(() => {
  Object.assign(config, saved);
  setJevImpl(null);
  setLlmImpl(null);
});

function enableJev(mode: "shadow" | "enforce" = "enforce"): void {
  config.jevGate = "jev";
  config.jevMode = mode;
  config.jevKey = "test-key";
  config.jevThreshold = 0.45;
}

/** 计数假 LLM（返回任务意图） */
function countingTaskLlm(): { calls: () => number } {
  const state = { n: 0 };
  setLlmImpl(async () => {
    state.n += 1;
    return JSON.stringify(makeIntent({ is_task: true, confidence: "high", content: "写周报", assignee_hint: "张三", deadline_hint: "周五前" }));
  });
  return { calls: () => state.n };
}

describe("Jev 门（processMessage 前置）", () => {
  it("默认关闭：Jev 一次都不调，行为与加固前一致", async () => {
    setJevImpl(async () => { throw new Error("Jev 不应被调用"); });
    const llm = countingTaskLlm();
    const r = await processMessage("张三 周五前写周报", "李娜");
    expect(r.action).toBe("task_created");
    expect(llm.calls()).toBe(1);
    expect(Number((await one("SELECT COUNT(*)::int AS n FROM audit WHERE actor='gate'"))!.n)).toBe(0);
  });

  it("enforce + 低概率 → skip：不调 LLM、不建任务、记 jev_skip", async () => {
    enableJev("enforce");
    setJevImpl(async () => ({ needs_attention: { noul: 0.1 }, assign_mode: { choice: "none" } }));
    const llm = countingTaskLlm();
    const r = await processMessage("哈哈今天天气不错", "李娜");
    expect(r.action).toBe("skip");
    expect(llm.calls()).toBe(0);
    expect(Number((await one("SELECT COUNT(*)::int AS n FROM task WHERE content='写周报'"))!.n)).toBe(0);
    const skip = await one("SELECT detail FROM audit WHERE actor='gate' AND action='jev_skip'");
    expect(skip).not.toBeNull();
    expect(JSON.parse(skip!.detail as string).p).toBe(0.1);
  });

  it("enforce + 高概率 → 放行 LLM 建任务，记 jev_pass", async () => {
    enableJev("enforce");
    setJevImpl(async () => ({ needs_attention: { noul: 0.95 }, assign_mode: { choice: "assigned" } }));
    const llm = countingTaskLlm();
    const r = await processMessage("张三 周五前写周报", "李娜");
    expect(r.action).toBe("task_created");
    expect(llm.calls()).toBe(1);
    const pass = await one("SELECT detail FROM audit WHERE actor='gate' AND action='jev_pass'");
    expect(JSON.parse(pass!.detail as string).agree).toBe(true);
  });

  it("shadow + 低概率 → 不拦截，LLM 照跑，双方判定都入审计", async () => {
    enableJev("shadow");
    setJevImpl(async () => ({ needs_attention: { noul: 0.1 }, assign_mode: { choice: "none" } }));
    const llm = countingTaskLlm();
    const r = await processMessage("哈哈今天天气不错", "李娜");
    expect(r.action).toBe("task_created"); // shadow 不拦截：LLM 认为是任务就建
    expect(llm.calls()).toBe(1);
    const shadow = await one("SELECT detail FROM audit WHERE actor='gate' AND action='jev_shadow'");
    const d = JSON.parse(shadow!.detail as string);
    expect(d.p).toBe(0.1);
    expect(d.sf_is_task).toBe(true);
    expect(d.agree).toBe(false);
  });

  it("Jev 调用抛错 → 门让位，全量 LLM 路径照常（可用性优先）", async () => {
    enableJev("enforce");
    setJevImpl(async () => { throw new Error("Jev HTTP 500"); });
    const llm = countingTaskLlm();
    const r = await processMessage("张三 周五前写周报", "李娜");
    expect(r.action).toBe("task_created");
    expect(llm.calls()).toBe(1);
  });
});

describe("Jev 口头完成匹配（handleCompletion 多候选）", () => {
  async function mkTwoTasks(assignee: string): Promise<[number, number]> {
    await query("INSERT INTO task(content,creator,assignee,status,confidence) VALUES('完成匹配甲','u',$1,'confirmed','high')", [assignee]);
    await query("INSERT INTO task(content,creator,assignee,status,confidence) VALUES('完成匹配乙','u',$1,'confirmed','high')", [assignee]);
    const a = Number((await one("SELECT id FROM task WHERE content='完成匹配甲'"))!.id);
    const b = Number((await one("SELECT id FROM task WHERE content='完成匹配乙'"))!.id);
    return [a, b];
  }

  it("Jev Choice 选中哪条就完成哪条（不碰另一条）", async () => {
    enableJev();
    const [idA, idB] = await mkTwoTasks("王芳");
    setJevImpl(async (state) => {
      const opts = state.candidate_tasks as Record<string, string>;
      const key = Object.keys(opts).find((k) => opts[k].includes("完成匹配乙"))!;
      return { completion: { choice: key } };
    });
    const picked = await handleCompletion("乙那个我做完了", "王芳");
    expect(picked?.id).toBe(idB);
    expect((await one("SELECT status FROM task WHERE id=$1", [idA]))!.status).toBe("confirmed");
    expect((await one("SELECT status FROM task WHERE id=$1", [idB]))!.status).toBe("done");
  });

  it("Jev 判'都不是' → 不完成任何一条（治无脑完成最近一条）", async () => {
    enableJev();
    const [idA, idB] = await mkTwoTasks("王芳");
    setJevImpl(async () => ({ completion: { choice: "none" } }));
    const picked = await handleCompletion("随便说说而已", "王芳");
    expect(picked).toBeNull();
    expect((await one("SELECT status FROM task WHERE id=$1", [idA]))!.status).toBe("confirmed");
    expect((await one("SELECT status FROM task WHERE id=$1", [idB]))!.status).toBe("confirmed");
  });

  it("Jev 未启用 → 维持旧行为（多候选取最近一条）", async () => {
    const [, idB] = await mkTwoTasks("王芳"); // 乙是后插入的（id 更大=最近）
    setJevImpl(async () => { throw new Error("Jev 不应被调用"); });
    const picked = await handleCompletion("做完了", "王芳");
    expect(picked?.id).toBe(idB);
  });

  it("单候选不走 Jev（确定性路径，零调用）", async () => {
    enableJev();
    await query("INSERT INTO task(content,creator,assignee,status,confidence) VALUES('唯一条','u','王芳','confirmed','high')");
    const id = Number((await one("SELECT id FROM task WHERE content='唯一条'"))!.id);
    setJevImpl(async () => { throw new Error("Jev 不应被调用"); });
    const picked = await handleCompletion("做完了", "王芳");
    expect(picked?.id).toBe(id);
    expect((await one("SELECT status FROM task WHERE id=$1", [id]))!.status).toBe("done");
  });
});
