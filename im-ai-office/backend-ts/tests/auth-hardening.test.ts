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
