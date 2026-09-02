import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, db, waitFor } from "./helpers";

// P3 acceptance：自建聊天层契约版 12 项（acceptance.py 移植版的契约升级）
// 变更点：登录走 /api/auth/login（session token）；发消息走 /api/messages/send
// （内联 AI 闸门平移）；parity 门禁不降级。
// 前置：后端起在 8000（真实 LLM/PG 生产库）；IMAI_E2E_BASE 可覆盖地址
const CONV = "sg_1591442033";
const SENDER = "张敏(e2e)";
const RUN = new Date().toISOString().slice(11, 19).replace(/[:T-]/g, "") + Math.floor(Math.random() * 90 + 10);
const E2E_USERNAME = `e2e${RUN}`;
const E2E_PASSWORD = `e2e-pass-${RUN}`;
const E2E_UID = "user001";

let TOKEN = "";

let taskRow: { id: number; status: string } | null = null;

async function cleanup() {
  // 按标记清理（e2e 用户 + e2e 消息/任务/私聊）
  await db("DELETE FROM session WHERE user_id IN (SELECT id FROM app_user WHERE username LIKE 'e2e%')");
  await db("DELETE FROM group_member WHERE user_id IN (SELECT id FROM app_user WHERE username LIKE 'e2e%')");
  await db("DELETE FROM app_user WHERE username LIKE 'e2e%'");
  await db("DELETE FROM task WHERE creator=$1 OR content LIKE '%房间%'", [SENDER]);
  await db("DELETE FROM message WHERE sender_name=$1 OR client_msg_id LIKE 'e2e-%'", [SENDER]);
  await db("DELETE FROM ai_dm WHERE sender_id=$1", [E2E_UID]);
  await db("DELETE FROM event_dedup");
}

async function send(text: string, extra: string) {
  return api("/api/messages/send", {
    conv_id: CONV, text, client_msg_id: `e2e-${RUN}-${extra}`,
  }, "POST", { Authorization: `Bearer ${TOKEN}` });
}

async function waitTask(timeout = 30000) {
  return waitFor(async () => {
    const rows = await db<{ id: number; status: string }[]>(
      `SELECT id, status FROM task WHERE creator=$1
       AND created_at > now() - interval '3 minutes' ORDER BY id DESC`,
      [SENDER],
    );
    return rows[0] ?? null;
  }, timeout, 2000);
}

beforeAll(async () => {
  await cleanup();
  // 专用 e2e 用户（displayName = 发送者名，任务 creator 与历史清理都对齐）
  const { upsertPassword } = await import("../src/auth.js");
  await upsertPassword(E2E_USERNAME, E2E_PASSWORD, E2E_UID, SENDER);
  const login = await api("/api/auth/login", { username: E2E_USERNAME, password: E2E_PASSWORD }, "POST");
  expect(login.ok).toBe(true);
  TOKEN = String(login.token);
});

afterAll(async () => {
  await cleanup();
  const { pool } = await import("./helpers");
  await pool.end();
});

describe("IMAI 一键验收（自建聊天层契约）", () => {
  it("[0] 服务健康：后端 8000 可达", async () => {
    const r = await api("/api/tasks");
    expect(r).toBeDefined();
  });

  it("[0] 启动时无 e2e 任务残留", async () => {
    const rows = await db<{ c: string }[]>("SELECT count(*) AS c FROM task WHERE creator=$1", [SENDER]);
    expect(Number(rows[0].c)).toBe(0);
  });

  it("[1] messages/send 接受", async () => {
    const r = await send(`李自成 下午办公室讲ppt（批次${RUN}）`, "base");
    expect(r.ok).toBe(true);
    expect(r.dedup).toBeUndefined();
    expect(r.id).toBeDefined();
  });

  it("[1] 消息已落库", async () => {
    const rows = await db<{ c: string }[]>(
      "SELECT count(*) AS c FROM message WHERE sender_name=$1 AND content LIKE $2",
      [SENDER, `%批次${RUN}%`],
    );
    expect(Number(rows[0].c)).toBeGreaterThanOrEqual(1);
  });

  it("[2] 任务已创建（AI 识别自然语句，内联闸门）", async () => {
    const r = await send(`李自成 明天上午10点开产品评审会，材料他来准备，房间${RUN}`, "task");
    expect(r.ok).toBe(true);
    taskRow = await waitTask();
    expect(taskRow).not.toBeNull();
  });

  it("[2] 截止时间解析（任务进入确认/已确认态）", async () => {
    expect(["pending_confirmation", "confirmed"]).toContain(taskRow?.status);
  });

  it("[3] confirm 流转", async () => {
    const tid = taskRow!.id;
    const before = taskRow!.status;
    await api(`/api/tasks/${tid}/confirm`, {}, "POST");
    const after = await db<{ status: string }[]>("SELECT status FROM task WHERE id=$1", [tid]);
    expect(after[0].status).toBe("confirmed");
    expect(before).not.toBe("confirmed"); // 翻转发生
  });

  it("[4] 防重放：首投消息已入库", async () => {
    await send(`王五 周五前发周报，编号${RUN}`, "replay");
    await waitFor(async () => {
      const rows = await db<{ c: string }[]>(
        "SELECT count(*) AS c FROM message WHERE sender_name=$1 AND content LIKE $2",
        [SENDER, `%编号${RUN}%`],
      );
      return Number(rows[0].c) >= 1 ? true : null;
    });
    const rows = await db<{ c: string }[]>(
      "SELECT count(*) AS c FROM message WHERE sender_name=$1 AND content LIKE $2",
      [SENDER, `%编号${RUN}%`],
    );
    expect(Number(rows[0].c)).toBeGreaterThanOrEqual(1);
  });

  it("[4] 防重放：同 clientMsgID 重投不重复入库（唯一约束幂等）", async () => {
    await send(`王五 周五前发周报，编号${RUN}`, "replay");
    await new Promise((r) => setTimeout(r, 2000));
    const rows = await db<{ c: string }[]>(
      "SELECT count(*) AS c FROM message WHERE sender_name=$1 AND content LIKE $2",
      [SENDER, `%编号${RUN}%`],
    );
    expect(Number(rows[0].c)).toBe(1);
  });

  it("[4] 防重放：重投被端点幂等拦截", async () => {
    const r = await send(`王五 周五前发周报，编号${RUN}`, "replay");
    expect(r.dedup).toBe(true);
  });

  it("[4] 全表无重复 client_msg_id", async () => {
    const dups = await db(
      `SELECT conv_id, client_msg_id, count(*) FROM message
       WHERE client_msg_id IS NOT NULL GROUP BY 1,2 HAVING count(*)>1`,
    );
    expect(dups.length).toBe(0);
  });

  it("[5] 看板接口返回", async () => {
    const board = await api("/api/tasks");
    expect(["object", "array"]).toContain(typeof board);
  });
});
