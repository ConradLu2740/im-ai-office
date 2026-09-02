import { describe, it, expect } from "vitest";
import { pool } from "./setup.js";
import "./setup.js";
import { makeFakeLlm, makeIntent } from "./setup.js";
import { query, one } from "../src/db.js";

// G 系关键守卫移植（test_g11/g12/g3/g4 精选）：TS 后端的核心不变量

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const { app } = await import("../src/app.js");
  const res = await app.request(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function get(path: string): Promise<Record<string, unknown>> {
  const { app } = await import("../src/app.js");
  const res = await app.request(path);
  return res.json() as Promise<Record<string, unknown>>;
}

describe("G11 · 回调唯一入口 + SSE", () => {
  it("群消息回调：落库 + fanout message 事件 + 同 clientMsgID 幂等", async () => {
    makeFakeLlm([{ match: "随便聊聊", intent: makeIntent({ is_task: false, confidence: "low", is_completion: false }) }]);
    const events: string[] = [];
    const { subscribe, unsubscribe } = await import("../src/sse.js");
    const sink = (line: string) => events.push(line);
    subscribe(sink);
    try {
      const payload = { msgID: "g11-m1", groupID: "g11grp", sendID: "user002",
        senderNickname: "张三", contentType: "101", content: "随便聊聊天气", clientMsgID: "cmid-g11-1" };
      const r1 = await post("/callback", payload);
      expect(r1.ok).toBe(true);
      const rows = await query("SELECT * FROM message WHERE conv_id='sg_g11grp' AND client_msg_id='cmid-g11-1'");
      expect(rows.length).toBe(1);
      const ev = JSON.parse(events.find((e) => e.includes("message")) ?? "{}");
      expect(ev.conv_id).toBe("sg_g11grp");
      expect(ev.client_msg_id).toBe("cmid-g11-1");
      // 重投递被闸门拦截
      const r2 = await post("/callback", payload);
      expect(r2.action).toBe("client_msg_id_seen");
      expect((await query("SELECT COUNT(*)::int AS n FROM message WHERE client_msg_id='cmid-g11-1'"))[0].n).toBe(1);
    } finally { unsubscribe(sink); }
  });

  it("send_message：纯代发不落库不建任务 + 透传 clientMsgID + 审计", async () => {
    const { setOpenimPost } = await import("../src/openim.js");
    setOpenimPost(() => Promise.resolve({ errCode: 0, data: { serverMsgID: "srv-g11" } }));
    const r = await post("/openim/send_message", {
      user_id: "user001", group_id: "g1", sender_name: "user001",
      text: "安排个事", client_msg_id: "cmid-send-1" });
    expect(r.ok).toBe(true);
    expect((await query("SELECT COUNT(*)::int AS n FROM message WHERE client_msg_id='cmid-send-1'"))[0].n).toBe(0);
    expect((await query("SELECT COUNT(*)::int AS n FROM task"))[0].n).toBe(0);
    const audits = await query("SELECT actor FROM audit WHERE action='send_message'");
    expect(audits[0].actor).toBe("user:user001");
    // 缺 client_msg_id 拒绝
    const bad = await post("/openim/send_message", { user_id: "user001", group_id: "g1", text: "hi" });
    expect(bad.ok).toBe(false);
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
    const r = await post("/api/sdk_message", { sender: "user001", text: "周报做完了",
      conv_id: "sg_g12", send_id: "user001", client_msg_id: "g12-cmid-1" });
    expect((r.ai as Record<string, unknown>).action).toBe("task_completed");
    expect((await one("SELECT status FROM task WHERE id=$1", [tid]))!.status).toBe("done");
    makeFakeLlm([{ match: "另一个事", intent: makeIntent({ is_task: false, confidence: "low",
      is_completion: true, content: "另一个事" }) }]);
    const r2 = await post("/api/sdk_message", { sender: "nobody999", text: "另一个事搞定了",
      conv_id: "sg_g12", send_id: "nobody999", client_msg_id: "g12-cmid-2" });
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
    // admin 批复 → approved + 代发
    const aid = pending[0].id;
    const d = await post(`/api/approvals/${aid}/decide`, { approved: true, decided_by: "imAdmin" });
    expect((d.approval as Record<string, unknown>).status).toBe("approved");
    // 识别 → 确认流
    makeFakeLlm([{ match: "我来写周报", intent: makeIntent({ is_task: true, confidence: "high",
      content: "写周报", assignee_hint: "我", deadline_hint: "周五前", assign_mode: "self" }) }]);
    const ai = await post("/api/sdk_message", { sender: "user001", text: "我来写周报",
      conv_id: "sg_g3", send_id: "user001", client_msg_id: "g3-cmid-1" });
    const taskId = ((ai.ai as Record<string, unknown>).task as Record<string, unknown>).taskId as number;
    expect((await post(`/api/tasks/${taskId}/confirm`, {})).ok).toBe(true);
    expect((await one("SELECT status FROM task WHERE id=$1", [taskId]))!.status).toBe("confirmed");
  });
});
void pool;
