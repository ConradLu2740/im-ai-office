import { describe, it, expect } from "vitest";
import { pool } from "./setup.js";
import "./setup.js";
import { makeFakeLlm, makeIntent } from "./setup.js";
import { query, one } from "../src/db.js";

// G 系关键守卫移植（test_g11/g12/g3/g4 精选）：TS 后端的核心不变量
// P3：发送入口改为 /api/messages/send（内联 AI 闸门），/callback 与 /openim/* 已删除

async function request(path: string, method: string, body?: unknown, token?: string): Promise<Record<string, unknown>> {
  const { app } = await import("../src/app.js");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await app.request(path, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<Record<string, unknown>>;
}

const post = (path: string, body?: unknown, token?: string) => request(path, "POST", body, token);

async function get(path: string): Promise<Record<string, unknown>> {
  const { app } = await import("../src/app.js");
  const res = await app.request(path);
  return res.json() as Promise<Record<string, unknown>>;
}

/** 直插用户 + 会话（send 端点鉴权用），返回 Bearer token */
async function mkSession(userId: string, displayName = "测试用户"): Promise<string> {
  const { randomBytes, scryptSync } = await import("node:crypto");
  const token = randomBytes(32).toString("hex");
  const passwordHash = `${randomBytes(16).toString("hex")}:${scryptSync("x", "s", 64).toString("hex")}`;
  await query(
    "INSERT INTO app_user(id, username, display_name, password_hash) VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
    [userId, `u-${userId}`, displayName, passwordHash]);
  await query("INSERT INTO session(token, user_id, expires_at) VALUES($1,$2, NOW() + INTERVAL '1 day')", [token, userId]);
  return token;
}

describe("G11 · 发送端点唯一入口 + SSE（P3 闸门平移）", () => {
  it("send：落库 + fanout message（DB id+client_msg_id）+ AI 内联 + 同 clientMsgID 幂等", async () => {
    makeFakeLlm([{ match: "随便聊聊", intent: makeIntent({ is_task: false, confidence: "low", is_completion: false }) }]);
    const token = await mkSession("user002", "张三");
    const events: string[] = [];
    const { subscribe, unsubscribe } = await import("../src/sse.js");
    const sink = (line: string) => events.push(line);
    subscribe(sink);
    try {
      const payload = { conv_id: "sg_g11grp", text: "随便聊聊天气", client_msg_id: "cmid-g11-1" };
      const r1 = await post("/api/messages/send", payload, token);
      expect(r1.ok).toBe(true);
      expect(r1.inserted !== false).toBe(true);
      const rows = await query("SELECT * FROM message WHERE conv_id='sg_g11grp' AND client_msg_id='cmid-g11-1'");
      expect(rows.length).toBe(1);
      const ev = JSON.parse(events.find((e) => e.includes("\"message\"")) ?? "{}");
      expect(ev.conv_id).toBe("sg_g11grp");
      expect(ev.client_msg_id).toBe("cmid-g11-1");
      expect(ev.db_id).toBe(rows[0].id);
      // 同 clientMsgID 重投 → 唯一约束幂等（dedup:true，不重复落库、不重复跑 AI）
      const r2 = await post("/api/messages/send", payload, token);
      expect(r2.ok).toBe(true);
      expect(r2.dedup).toBe(true);
      expect((await query("SELECT COUNT(*)::int AS n FROM message WHERE client_msg_id='cmid-g11-1'"))[0].n).toBe(1);
    } finally { unsubscribe(sink); }
  });

  it("send 守卫：未认证拒绝 + 缺 client_msg_id 拒绝 + 非 sg_ 会话拒绝", async () => {
    const token = await mkSession("user003", "李四");
    const noAuth = await post("/api/messages/send", { conv_id: "sg_x", text: "hi", client_msg_id: "c-1" });
    expect(noAuth.ok).toBe(false);
    const noCmid = await post("/api/messages/send", { conv_id: "sg_x", text: "hi" }, token);
    expect(noCmid.ok).toBe(false);
    const badConv = await post("/api/messages/send", { conv_id: "dm_x", text: "hi", client_msg_id: "c-2" }, token);
    expect(badConv.ok).toBe(false);
  });
});

describe("G12 · 完成回流 + G4 观测", () => {
  async function mkTask(content: string, assignee = "user001"): Promise<number> {
    await query("INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [content, "user001", assignee, "周五前", "confirmed", "high", "s"]);
    return Number((await one("SELECT id FROM task WHERE content=$1 ORDER BY id DESC LIMIT 1", [content]))!.id);
  }

  it("complete 端点：confirmed → done + audit；二次拒绝；done 不触发提醒档位", async () => {
    const tid = await mkTask("出季度数据报表");
    const r = await post(`/api/tasks/${tid}/complete`, { actor: "user001" });
    expect(r.ok).toBe(true);
    expect((await one("SELECT status FROM task WHERE id=$1", [tid]))!.status).toBe("done");
    expect(Number((await one("SELECT COUNT(*)::int AS n FROM audit WHERE action='task_completed'"))!.n)).toBeGreaterThanOrEqual(1);
    expect((await post(`/api/tasks/${tid}/complete`, { actor: "user001" })).ok).toBe(false);
    const { judgeTiers } = await import("../src/reminder.js");
    expect(judgeTiers({ status: "done", assignee: "user001", deadline: "周五",
      deadline_at: "2026-08-01 10:00", created_at: "2026-08-01 09:00" })).toEqual([]);
  });

  it("口头完成：is_completion 命中 → 最近确认任务 done；无匹配 skip", async () => {
    const tid = await mkTask("写周报");
    makeFakeLlm([{ match: "周报做完了", intent: makeIntent({ is_task: false, confidence: "low",
      is_completion: true, content: "周报" }) }]);
    const token = await mkSession("user001", "user001"); // displayName 与 task.assignee 匹配（同 OpenIM 昵称语义）
    const r = await post("/api/messages/send", { text: "周报做完了",
      conv_id: "sg_g12", client_msg_id: "g12-cmid-1" }, token);
    expect((r.ai as Record<string, unknown>).action).toBe("task_completed");
    expect((await one("SELECT status FROM task WHERE id=$1", [tid]))!.status).toBe("done");
    makeFakeLlm([{ match: "另一个事", intent: makeIntent({ is_task: false, confidence: "low",
      is_completion: true, content: "另一个事" }) }]);
    const token2 = await mkSession("nobody999");
    const r2 = await post("/api/messages/send", { text: "另一个事搞定了",
      conv_id: "sg_g12", client_msg_id: "g12-cmid-2" }, token2);
    expect((r2.ai as Record<string, unknown>).action).toBe("skip");
  });

  it("G4：不可解析截止 → deadline_unparsed 一次", async () => {
    await query("INSERT INTO task(content,creator,assignee,deadline,status,confidence,source_msg) VALUES('玄学任务','李娜(娜姐)','张三','宇宙末日之前','confirmed','high','s')");
    const { backfillPending } = await import("../src/deadline.js");
    await backfillPending();
    await backfillPending();
    expect(Number((await one("SELECT COUNT(*)::int AS n FROM audit WHERE action='deadline_unparsed'"))!.n)).toBe(1);
  });
});

describe("G3 · RBAC 与确认流", () => {
  it("角色往返 + 高风险审批 + 完成闭环", async () => {
    const r = await post("/api/role/set", { oim_user_id: "user001", role: "group_admin" });
    expect(r.ok).toBe(true);
    expect((await get("/api/role/user001")).role).toBe("group_admin");
    expect((await post("/api/role/set", { oim_user_id: "user001", role: "superadmin" })).ok).toBe(false);
    // member 高风险 → pending
    const n = await post("/api/notify/request", { group_id: "sg_001", text: "今晚 8 点发布", actor: "sim_user" });
    expect(n.direct).toBe(false);
    const pending = (await get("/api/approvals?status=pending")).approvals as Array<Record<string, unknown>>;
    expect(pending.length).toBe(1);
    // admin 批复 → approved
    const aid = pending[0].id;
    const d = await post(`/api/approvals/${aid}/decide`, { approved: true, decided_by: "imAdmin" });
    expect((d.approval as Record<string, unknown>).status).toBe("approved");
    // 识别 → 确认流（经新发送端点）
    makeFakeLlm([{ match: "我来写周报", intent: makeIntent({ is_task: true, confidence: "high",
      content: "写周报", assignee_hint: "我", deadline_hint: "周五前", assign_mode: "self" }) }]);
    const token = await mkSession("user001");
    const ai = await post("/api/messages/send", { text: "我来写周报",
      conv_id: "sg_g3", client_msg_id: "g3-cmid-1" }, token);
    const taskId = ((ai.ai as Record<string, unknown>).task as Record<string, unknown>).taskId as number;
    expect((await post(`/api/tasks/${taskId}/confirm`, {})).ok).toBe(true);
    expect((await one("SELECT status FROM task WHERE id=$1", [taskId]))!.status).toBe("confirmed");
  });
});
describe("G13 · 质量统计口径（真实口径排除派生/测试流量）", () => {
  it("core 通过率排除 mine#/minutes# 派生任务；延迟按来源拆分", async () => {
    // 造两类任务：真实任务 + 挖掘派生任务，各配一对 confirm/reject 审计
    const real = await one<{ id: string }>(
      "INSERT INTO task(content,creator,assignee,status,confidence) VALUES('真实任务','张伟','张伟','confirmed','high') RETURNING id");
    const mined = await one<{ id: string }>(
      "INSERT INTO task(content,creator,assignee,status,confidence) VALUES('挖掘候选','mine#1','张伟','rejected','medium') RETURNING id");
    await query("INSERT INTO audit(actor,action,detail,ts) VALUES('g13','confirm',$1,NOW())", [JSON.stringify({ taskId: Number(real!.id) })]);
    await query("INSERT INTO audit(actor,action,detail,ts) VALUES('g13','reject',$1,NOW())", [JSON.stringify({ taskId: Number(mined!.id), reason: "负责人错了" })]);
    await query("INSERT INTO audit(actor,action,detail,ts) VALUES('g13','ai_processed',$1,NOW())",
      [JSON.stringify({ msgId: "g13-1", action: "task_created", taskId: Number(real!.id), latency_ms: 1500, source: "send_endpoint" })]);
    await query("INSERT INTO audit(actor,action,detail,ts) VALUES('g13','ai_processed',$1,NOW())",
      [JSON.stringify({ msgId: "g13-2", action: "task_created", taskId: Number(mined!.id), latency_ms: 60000, source: "sdk_message" })]);

    const rep = await get("/api/stats/quality?days=7");
    expect(rep.ok).toBe(true);
    // auditLog 必须写 ts（漏写 → 新行被统计窗口静默过滤，2026-09-03 实证）
    const { auditLog } = await import("../src/repos.js");
    await auditLog("g13", "ts_probe", { probe: true });
    const probe = await one<{ ts: string | null }>("SELECT ts FROM audit WHERE actor='g13' AND action='ts_probe' ORDER BY id DESC LIMIT 1");
    expect(probe!.ts).not.toBeNull();
    const core = rep.core as { confirm: number; reject: number; one_pass_rate: number };
    // 真实口径：挖掘派生任务的 reject 被排除 → 只剩 1 confirm / 0 reject
    expect(core.confirm).toBe(1);
    expect(core.reject).toBe(0);
    expect(core.one_pass_rate).toBe(1);
    // 全量口径不受影响（含挖掘 reject）
    expect((rep.totals as Record<string, number>).reject).toBeGreaterThanOrEqual(1);
    // 延迟分源：send_endpoint 不被 sdk_message 的 60s 样本污染
    const bySrc = rep.latency_by_source as Array<{ source: string; n: number; p95_ms: number }>;
    const send = bySrc.find((s) => s.source === "send_endpoint");
    const sdk = bySrc.find((s) => s.source === "sdk_message");
    expect(send?.n).toBeGreaterThanOrEqual(1);
    expect(send!.p95_ms).toBeLessThan(10000);
    expect(sdk!.p95_ms).toBeGreaterThan(50000);
  });
});
void pool;
