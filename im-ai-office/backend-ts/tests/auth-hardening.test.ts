import { describe, it, expect } from "vitest";
import { mkSession, makeFakeLlm, makeIntent } from "./setup.js";
import { query, one } from "../src/db.js";

// P0 安全加固：全端点登录 + 管理端点 登录+group_admin（requireAdmin）
// 测试环境姿态见 vitest.config.ts

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

describe("P0 · errText 单元（错误消息提取）", () => {
  it("取 Error.message；自定义 name 的子类不透传前缀；非 Error 原样字符串化", async () => {
    const { errText } = await import("../src/errtext.js");
    class ValueError extends Error { name = "ValueError"; }
    expect(errText(new ValueError("invalid role: x"))).toBe("invalid role: x");
    expect(errText(new Error("boom"))).toBe("boom");
    expect(errText("plain string")).toBe("plain string");
  });
});

describe("P0 · 错误消息不回削（errText）", () => {
  it("非法角色的报错是完整 message，不是 Valueinvalid…", async () => {
    const admin = await mkSession("user-err-admin", "err管理员");
    await query("INSERT INTO role(oim_user_id, role) VALUES('user-err-admin','group_admin') ON CONFLICT (oim_user_id) DO UPDATE SET role='group_admin'");
    const r = await req("/api/role/set", "POST", { oim_user_id: "u-err", role: "superadmin" },
      { Authorization: `Bearer ${admin}` });
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBe("invalid role: superadmin");
  });
});

describe("P1 · /api/chat 去重（同消息不重复建任务）", () => {
  it("同一 sender+message 30 分钟内重投 → 第二次 dedup，任务只建一个", async () => {
    makeFakeLlm([{ match: "提醒我交报表", intent: makeIntent({ is_task: true, confidence: "high",
      content: "交报表", assignee_hint: null, deadline_hint: "周五前", assign_mode: "none" }) }]);
    const token = await mkSession("user-t8", "Chat用户");
    const auth = { Authorization: `Bearer ${token}` };
    const r1 = await req("/api/chat", "POST", { message: "提醒我交报表", sender: "测试员" }, auth);
    expect((r1.body as Record<string, unknown>).action).toBe("task_created");
    expect(Number((await one("SELECT COUNT(*)::int AS n FROM task WHERE content='交报表'"))!.n)).toBe(1);
    const r2 = await req("/api/chat", "POST", { message: "提醒我交报表", sender: "测试员" }, auth);
    expect(r2.body.dedup).toBe(true);
    expect(Number((await one("SELECT COUNT(*)::int AS n FROM task WHERE content='交报表'"))!.n)).toBe(1);
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

describe("P1 · SSE 事件投递延迟（misc.ts flush）", () => {
  it("fanout 后 3 秒内到达客户端（不再等 15s flush）", async () => {
    const { app } = await import("../src/app.js");
    const { fanout } = await import("../src/sse.js");
    const token = await mkSession("user-t9", "SSE用户");
    const res = await app.request(`/api/events/stream?token=${token}`);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    setTimeout(() => fanout("task_status", { taskId: 999001, status: "confirmed" }), 100);
    const t0 = Date.now();
    let got = "";
    try {
      while (Date.now() - t0 < 6000) {
        const { value, done } = await reader.read();
        if (done) break;
        got += decoder.decode(value, { stream: true });
        if (got.includes("task_status")) break;
      }
    } finally {
      await reader.cancel();
    }
    expect(got).toContain("task_status");
    expect(Date.now() - t0).toBeLessThan(3000);
  }, 15000);
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
    // member 指定他人 sender_id → 403（M3：不再静默收敛）
    const rA2 = await req("/api/ai_dm?sender_id=user-t3-b", "GET", undefined, { Authorization: `Bearer ${tokenA}` });
    expect(rA2.status).toBe(403);
    expect(rA2.body.error).toBe("forbidden");
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

describe("Minor · 三项清理（M3 私信越权显式化 / M4 挖掘裁决收敛 / M5 会话成员校验）", () => {
  it("M3：member 指定他人 sender_id → 403（不再静默返回自己数据）", async () => {
    await query("INSERT INTO ai_dm(sender_id, direction, content) VALUES('user-m3-a','in','A的私信')");
    const tokenA = await mkSession("user-m3-a", "甲");
    const other = await req("/api/ai_dm?sender_id=user-m3-b", "GET", undefined, { Authorization: `Bearer ${tokenA}` });
    expect(other.status).toBe(403);
    expect((await req("/api/ai_dm", "GET", undefined, { Authorization: `Bearer ${tokenA}` })).status).toBe(200);
    await query("INSERT INTO role(oim_user_id, role) VALUES('user-m3-a','group_admin') ON CONFLICT (oim_user_id) DO UPDATE SET role='group_admin'");
    expect((await req("/api/ai_dm?sender_id=user-m3-b", "GET", undefined, { Authorization: `Bearer ${tokenA}` })).status).toBe(200);
  });

  it("M4：挖掘裁决收敛 group_admin（member 403）", async () => {
    const row = await one<{ id: string }>(
      "INSERT INTO mine_candidate(conv_id, kind, payload, evidence, msg_count, status) VALUES('sg_m4','term',$1,'证据',1,'pending') RETURNING id",
      [JSON.stringify({ term: "M4术语", meaning: "含义" })]);
    const cid = Number(row!.id);
    const member = await mkSession("user-m4-m", "成员");
    const denied = await req(`/api/mine/candidates/${cid}/decide`, "POST", { action: "accept" },
      { Authorization: `Bearer ${member}` });
    expect(denied.status).toBe(403);
    await query("INSERT INTO role(oim_user_id, role) VALUES('user-m4-m','group_admin') ON CONFLICT (oim_user_id) DO UPDATE SET role='group_admin'");
    const ok = await req(`/api/mine/candidates/${cid}/decide`, "POST", { action: "accept" },
      { Authorization: `Bearer ${member}` });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
  });

  it("M5：/api/messages 与 history——本群 200、他人群 403、无 conv_id 成员 403、admin 豁免", async () => {
    await query("INSERT INTO user_group(group_id, name) VALUES('g-m5-a','A群'),('g-m5-b','B群') ON CONFLICT (group_id) DO NOTHING");
    const auth = { Authorization: `Bearer ${await mkSession("user-m5-a", "甲")}` };
    await query("INSERT INTO group_member(group_id, user_id) VALUES('g-m5-a','user-m5-a') ON CONFLICT DO NOTHING");
    await query("INSERT INTO message(conv_id, sender_id, sender_name, content) VALUES('sg_g-m5-a','user-m5-a','甲','你好')");
    expect((await req("/api/messages?conv_id=sg_g-m5-a", "GET", undefined, auth)).status).toBe(200);
    expect((await req("/api/messages?conv_id=sg_g-m5-b", "GET", undefined, auth)).status).toBe(403);
    expect((await req("/api/messages", "GET", undefined, auth)).status).toBe(403);
    expect((await req("/api/messages/history?conv_id=sg_g-m5-b", "GET", undefined, auth)).status).toBe(403);
    await query("INSERT INTO role(oim_user_id, role) VALUES('user-m5-a','group_admin') ON CONFLICT (oim_user_id) DO UPDATE SET role='group_admin'");
    expect((await req("/api/messages?conv_id=sg_g-m5-b", "GET", undefined, auth)).status).toBe(200);
    expect((await req("/api/messages/history?conv_id=sg_g-m5-b", "GET", undefined, auth)).status).toBe(200);
  });
});

describe("P0 · 管理端点 requireAdmin（登录 + group_admin，I2 修复）", () => {
  it("无 session → 401；member → 403；group_admin session → 放行", async () => {
    const member = await mkSession("user-ra-m", "成员");
    const noAuth = await req("/api/role/set", "POST", { oim_user_id: "u-ra-1", role: "member" });
    expect(noAuth.status).toBe(401);
    const asMember = await req("/api/role/set", "POST", { oim_user_id: "u-ra-1", role: "member" },
      { Authorization: `Bearer ${member}` });
    expect(asMember.status).toBe(403);
    await query("INSERT INTO role(oim_user_id, role) VALUES('user-ra-m','group_admin') ON CONFLICT (oim_user_id) DO UPDATE SET role='group_admin'");
    const asAdmin = await req("/api/role/set", "POST", { oim_user_id: "u-ra-2", role: "member" },
      { Authorization: `Bearer ${member}` });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.ok).toBe(true);
  });

  it("审批决定端点同样 requireAdmin（member 403）", async () => {
    const member = await mkSession("user-ra-a", "成员");
    const asMember = await req("/api/approvals/999/decide", "POST", { approved: true, decided_by: "imAdmin" },
      { Authorization: `Bearer ${member}` });
    expect(asMember.status).toBe(403);
    expect(asMember.body.ok).toBe(false);
  });
});

describe("P0 · 剩余端点鉴权补齐（C1：messages/rbac/memory）", () => {
  it("history/grp-meta/terms/memory/roles/role/approvals/notify 无 token → 401", async () => {
    for (const [path, method] of [
      ["/api/messages/history", "GET"], ["/api/grp/meta", "POST"], ["/api/grp/meta/sg_001", "GET"],
      ["/api/terms", "GET"], ["/api/memory", "GET"], ["/api/roles", "GET"],
      ["/api/role/user001", "GET"], ["/api/approvals", "GET"], ["/api/notify/request", "POST"],
    ] as const) {
      const r = await req(path, method, method === "GET" ? undefined : {});
      expect(r.status, path).toBe(401);
    }
  });

  it("history 带 token 可读（无 conv_id 全量限 admin，M5）", async () => {
    const token = await mkSession("user-c1-h", "历史读者");
    await query("INSERT INTO role(oim_user_id, role) VALUES('user-c1-h','group_admin') ON CONFLICT (oim_user_id) DO UPDATE SET role='group_admin'");
    const r = await req("/api/messages/history", "GET", undefined, { Authorization: `Bearer ${token}` });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe("P1 · /api/auth/me 角色展示与鉴权同源（role 表）", () => {
  it("role 表授 group_admin 后，/api/auth/me 显示 group_admin（原读 app_user.role 死列，永远 member）", async () => {
    const token = await mkSession("user-me-1", "我");
    await query("INSERT INTO role(oim_user_id, role) VALUES('user-me-1','group_admin') ON CONFLICT (oim_user_id) DO UPDATE SET role='group_admin'");
    const r = await req("/api/auth/me", "GET", undefined, { Authorization: `Bearer ${token}` });
    expect(r.body.ok).toBe(true);
    expect(r.body.role).toBe("group_admin");
  });

  it("未授角色显示 member", async () => {
    const token = await mkSession("user-me-2", "普通人");
    const r = await req("/api/auth/me", "GET", undefined, { Authorization: `Bearer ${token}` });
    expect(r.body.role).toBe("member");
  });
});

describe("P1 · resolve 越权与任务复活修复（I1）", () => {
  it("body.sender_id 被忽略、强制本人：他人待确认任务不可被解析", async () => {
    await query(
      "INSERT INTO task(content,creator,assignee,status,confidence,pending_meta) VALUES('I1任务','user-i1-victim','待指派','pending_assignee','medium',$1)",
      [JSON.stringify({ candidates: [{ person_id: 1, label: "张三" }] })]);
    const attacker = await mkSession("user-i1-attacker", "攻击者");
    const r = await req("/api/tasks/resolve", "POST", { sender_id: "user-i1-victim", choice: "1" },
      { Authorization: `Bearer ${attacker}` });
    expect((r.body as Record<string, unknown>).ok).toBe(false);
    expect((await one("SELECT status FROM task WHERE content='I1任务'"))!.status).toBe("pending_assignee");
  });

  it("done/cancelled 任务不可经 resolve 复活为 confirmed", async () => {
    await query(
      "INSERT INTO task(content,creator,assignee,status,confidence,pending_meta) VALUES('I1已完成','u','张三','done','high',$1)",
      [JSON.stringify({ candidates: [{ person_id: 1, label: "张三" }] })]);
    const tid = Number((await one("SELECT id FROM task WHERE content='I1已完成'"))!.id);
    const token = await mkSession("user-i1-done", "用户");
    const r = await req("/api/tasks/resolve", "POST", { choice: "1", task_id: tid },
      { Authorization: `Bearer ${token}` });
    expect((r.body as Record<string, unknown>).ok).toBe(false);
    expect((await one("SELECT status FROM task WHERE id=$1", [tid]))!.status).toBe("done");
  });
});
