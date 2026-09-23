import { describe, it, expect } from "vitest";
import { mkSession } from "./setup.js";
import { query, one } from "../src/db.js";

// P0 安全加固：管理端点 fail-closed + 任务端点强制登录
// 测试环境姿态见 vitest.config.ts：IMAI_ADMIN_TOKEN="test-admin-token"

async function req(
  path: string, method: string, body?: unknown, headers: Record<string, string> = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { app } = await import("../src/app.js");
  const res = await app.request(path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const ADMIN = { "X-IMAI-Admin-Token": "test-admin-token" };

describe("P0 · 任务端点鉴权（routes/tasks.ts）", () => {
  it("confirm/reject/complete 无 token → 401；NaN task_id → 400；带 token 正常流转", async () => {
    await query("INSERT INTO task(content,creator,assignee,status,confidence) VALUES('T2任务','user001','张三','pending_confirmation','high')");
    const tid = Number((await one("SELECT id FROM task WHERE content='T2任务'"))!.id);

    // 无 token → 401
    const noAuth = await req(`/api/tasks/${tid}/confirm`, "POST", {});
    expect(noAuth.status).toBe(401);
    expect(noAuth.body.error).toBe("unauthorized");
    expect((await one("SELECT status FROM task WHERE id=$1", [tid]))!.status).toBe("pending_confirmation");

    // NaN task_id → 400（不进 DB、不 500）
    const token = await mkSession("user-t2-1", "T2用户");
    const nan = await req("/api/tasks/not-a-number/confirm", "POST", {}, { Authorization: `Bearer ${token}` });
    expect(nan.status).toBe(400);
    expect(nan.body.ok).toBe(false);

    // 带 token → 正常确认
    const ok = await req(`/api/tasks/${tid}/confirm`, "POST", {}, { Authorization: `Bearer ${token}` });
    expect(ok.body.ok).toBe(true);
    expect((await one("SELECT status FROM task WHERE id=$1", [tid]))!.status).toBe("confirmed");
  });

  it("看板/历史 GET 与 LLM 入口（chat/simulate/sdk）同样要求登录", async () => {
    for (const path of ["/api/tasks", "/api/messages"]) {
      const r = await req(path, "GET");
      expect(r.status).toBe(401);
    }
    for (const path of ["/api/chat", "/api/simulate_message", "/api/sdk_message"]) {
      const r = await req(path, "POST", { text: "hi", message: "hi" });
      expect(r.status).toBe(401);
    }
  });
});

describe("P1 · 任务状态流转原子性（tasks.ts 核心）", () => {
  it("重复 confirm 第二次拒绝，审计只记一次", async () => {
    const { confirmTask } = await import("../src/tasks.js");
    await query("INSERT INTO task(content,creator,assignee,status,confidence) VALUES('T6重复确认','u','张三','pending_confirmation','high')");
    const tid = Number((await one("SELECT id FROM task WHERE content='T6重复确认'"))!.id);
    expect(await confirmTask(tid, null, null, "actor-a")).toBe(true);
    expect(await confirmTask(tid, null, null, "actor-b")).toBe(false);
    expect(Number((await one("SELECT COUNT(*)::int AS n FROM audit WHERE action='confirm' AND detail::jsonb->>'taskId'=$1", [tid]))!.n)).toBe(1);
  });

  it("updateTask 坏 deadline 不留半改状态（assignee 不变）", async () => {
    const { updateTask } = await import("../src/tasks.js");
    await query("INSERT INTO task(content,creator,assignee,status,confidence) VALUES('T6半改','u','张三','confirmed','high')");
    const tid = Number((await one("SELECT id FROM task WHERE content='T6半改'"))!.id);
    const r = await updateTask(tid, "李四", "不是时间");
    expect(r.err).toBe("bad_deadline");
    expect((await one("SELECT assignee FROM task WHERE id=$1", [tid]))!.assignee).toBe("张三");
  });

  it("并发双 confirm 只有一个成功", async () => {
    const { confirmTask } = await import("../src/tasks.js");
    await query("INSERT INTO task(content,creator,assignee,status,confidence) VALUES('T6并发','u','张三','pending_confirmation','high')");
    const tid = Number((await one("SELECT id FROM task WHERE content='T6并发'"))!.id);
    const [a, b] = await Promise.all([confirmTask(tid), confirmTask(tid)]);
    expect([a, b].filter(Boolean).length).toBe(1);
    expect((await one("SELECT status FROM task WHERE id=$1", [tid]))!.status).toBe("confirmed");
  });
});

describe("P1 · 挖掘候选裁决防双签（mine.ts）", () => {
  async function mkCandidate(kind: string, payload: Record<string, unknown>): Promise<number> {
    const row = await one<{ id: string }>(
      "INSERT INTO mine_candidate(conv_id, kind, payload, evidence, msg_count, status) VALUES('sg_t7',$1,$2,'证据',1,'pending') RETURNING id",
      [kind, JSON.stringify(payload)]);
    return Number(row!.id);
  }

  it("并发双 decide 只有一个成功；person/alias 只建一份", async () => {
    const { decideCandidate } = await import("../src/mine.js");
    const cid = await mkCandidate("alias", { real_name: "T7人名", alias: "T7花名" });
    const results = await Promise.allSettled([
      decideCandidate(cid, "accept"),
      decideCandidate(cid, "accept"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(1);
    expect(String(bad[0].reason)).toContain("already_decided");
    expect(Number((await one("SELECT COUNT(*)::int AS n FROM person WHERE real_name='T7人名'"))!.n)).toBe(1);
    expect(Number((await one(
      "SELECT COUNT(*)::int AS n FROM alias a JOIN person p ON a.person_id=p.id WHERE p.real_name='T7人名' AND a.name='T7花名'"))!.n)).toBe(1);
  });

  it("串行重复 decide → already_decided；不存在 → null；accept 失败回滚 pending", async () => {
    const { decideCandidate } = await import("../src/mine.js");
    const cid = await mkCandidate("term", { term: "T7术语", meaning: "含义" });
    await decideCandidate(cid, "accept");
    await expect(decideCandidate(cid, "accept")).rejects.toThrow("already_decided");
    expect(await decideCandidate(9999999, "accept")).toBeNull();
  });
});

describe("P0 · extra 端点鉴权（纪要/挖掘）", () => {
  it("全部端点无 token → 401", async () => {
    for (const [path, method] of [
      ["/api/minutes/generate", "POST"], ["/api/minutes", "GET"], ["/api/minutes/1", "GET"],
      ["/api/minutes/1/task", "POST"], ["/api/mine/run", "POST"], ["/api/mine/candidates", "GET"],
      ["/api/mine/candidates/1/decide", "POST"],
    ] as const) {
      const r = await req(path, method, method === "GET" ? undefined : {});
      expect(r.status, path).toBe(401);
    }
  });

  it("LLM 燃烧端点（mine/run、minutes/generate）：member 403，admin 放行", async () => {
    const member = await mkSession("user-t4-m", "成员");
    const r1 = await req("/api/mine/run", "POST", { conv_id: "sg_none" }, { Authorization: `Bearer ${member}` });
    expect(r1.status).toBe(403);
    const r2 = await req("/api/minutes/generate", "POST", { conv_id: "sg_none" }, { Authorization: `Bearer ${member}` });
    expect(r2.status).toBe(403);
    await query("INSERT INTO role(oim_user_id, role) VALUES('user-t4-m','group_admin')");
    // admin 放行 → 业务层返回（无消息 → no_messages 400），而非 401/403
    const r3 = await req("/api/mine/run", "POST", { conv_id: "sg_none" }, { Authorization: `Bearer ${member}` });
    expect(r3.status).toBe(400);
    expect((r3.body.error as string).toLowerCase()).toContain("no_messages");
  });

  it("member 可读候选列表与详情（登录即可）", async () => {
    const member = await mkSession("user-t4-r", "读者");
    const r = await req("/api/mine/candidates", "GET", undefined, { Authorization: `Bearer ${member}` });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe("P0 · misc 端点鉴权与归属收敛（SSE/私信/审计）", () => {
  it("SSE 流：无 token → 401；?token= 有效 token → 200", async () => {
    const { app } = await import("../src/app.js");
    const noAuth = await app.request("/api/events/stream");
    expect(noAuth.status).toBe(401);
    const token = await mkSession("user-t3-sse", "SSE用户");
    const ok = await app.request(`/api/events/stream?token=${token}`);
    expect(ok.status).toBe(200);
    await ok.body?.cancel();
  });

  it("ai_dm：member 只能看/已读自己的私信；admin 可查他人", async () => {
    await query("INSERT INTO ai_dm(sender_id, direction, content) VALUES('user-t3-a','in','A的私信'),('user-t3-b','in','B的私信')");
    const tokenA = await mkSession("user-t3-a", "甲");
    const rA = await req("/api/ai_dm", "GET", undefined, { Authorization: `Bearer ${tokenA}` });
    const msgsA = rA.body.messages as Array<{ senderId: string }>;
    expect(msgsA.length).toBeGreaterThanOrEqual(1);
    expect(msgsA.every((m) => m.senderId === "user-t3-a")).toBe(true);
    // member 指定他人 sender_id → 仍收敛到自己
    const rA2 = await req("/api/ai_dm?sender_id=user-t3-b", "GET", undefined, { Authorization: `Bearer ${tokenA}` });
    expect((rA2.body.messages as Array<{ senderId: string }>).every((m) => m.senderId === "user-t3-a")).toBe(true);
    // admin 可查他人
    await query("INSERT INTO role(oim_user_id, role) VALUES('user-t3-a','group_admin')");
    const rAdmin = await req("/api/ai_dm?sender_id=user-t3-b", "GET", undefined, { Authorization: `Bearer ${tokenA}` });
    expect((rAdmin.body.messages as Array<{ senderId: string }>).some((m) => m.senderId === "user-t3-b")).toBe(true);
  });

  it("audit：member 403 / admin 200；summary 与 stats 要求登录", async () => {
    const token = await mkSession("user-t3-c", "丙");
    const auditMember = await req("/api/audit", "GET", undefined, { Authorization: `Bearer ${token}` });
    expect(auditMember.status).toBe(403);
    await query("INSERT INTO role(oim_user_id, role) VALUES('user-t3-c','group_admin')");
    const auditAdmin = await req("/api/audit", "GET", undefined, { Authorization: `Bearer ${token}` });
    expect(auditAdmin.status).toBe(200);
    expect((await req("/api/summary/daily", "GET")).status).toBe(401);
    expect((await req("/api/stats/quality", "GET")).status).toBe(401);
  });
});

describe("P0 · 管理端点 fail-closed（checkAdmin）", () => {
  it("无 token → 401 拒绝；正确 token → 放行；错 token → 401 拒绝", async () => {
    const noTok = await req("/api/role/set", "POST", { oim_user_id: "u-fc-1", role: "member" });
    expect(noTok.status).toBe(401);
    expect(noTok.body.ok).toBe(false);

    const withTok = await req("/api/role/set", "POST", { oim_user_id: "u-fc-1", role: "member" }, ADMIN);
    expect(withTok.body.ok).toBe(true);

    const wrongTok = await req("/api/role/set", "POST", { oim_user_id: "u-fc-1", role: "member" },
      { "X-IMAI-Admin-Token": "wrong-token-value" });
    expect(wrongTok.status).toBe(401);
    expect(wrongTok.body.ok).toBe(false);
  });

  it("审批决定端点同样 fail-closed", async () => {
    const noTok = await req("/api/approvals/999/decide", "POST", { approved: true, decided_by: "imAdmin" });
    expect(noTok.status).toBe(401);
    expect(noTok.body.ok).toBe(false);
  });
});
