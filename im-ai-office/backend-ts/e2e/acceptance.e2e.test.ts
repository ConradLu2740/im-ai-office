import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, db, strHash, waitFor } from "./helpers";

// acceptance.py 12 项逐条移植（Python 验收退役，parity 门禁不降级）
// 前置：后端起在 8000（真实 LLM/PG 生产库）；IMAI_E2E_BASE 可覆盖地址
const CONV = "sg_1591442033";
const SENDER = "张敏(e2e)";
const SEND_ID = "user001";
const RUN = new Date().toISOString().slice(11, 19).replace(/[:T-]/g, "") + Math.floor(Math.random() * 90 + 10);

let taskRow: { id: number; status: string } | null = null;

function cmid(extra: string, text: string): string {
  return `e2e-${RUN}-${extra}-${strHash(text)}`;
}

function send(text: string, extra: string) {
  return api("/api/sdk_message", {
    sender: SENDER,
    text,
    conv_id: CONV,
    send_id: SEND_ID,
    client_msg_id: cmid(extra, text),
  });
}

async function cleanup() {
  await db("DELETE FROM task WHERE creator=$1", [SENDER]);
  await db("DELETE FROM message WHERE sender_name=$1", [SENDER]);
  await db("DELETE FROM ai_dm WHERE sender_id=$1", [SEND_ID]);
}

async function waitTask(timeout = 30000) {
  // AI 抽取的标题不确定，按创建时间查（与 acceptance.py wait_task 一致）
  return waitFor(async () => {
    const rows = await db<{ id: number; status: string; content: string }[]>(
      `SELECT id, status, content FROM task WHERE creator=$1
       AND created_at > now() - interval '3 minutes' ORDER BY id DESC`,
      [SENDER],
    );
    return rows[0] ?? null;
  }, timeout, 2000);
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  // 关闭 helpers 的 pool
  const { pool } = await import("./helpers");
  await pool.end();
});

describe("IMAI 一键验收（acceptance 移植）", () => {
  it("[0] 服务健康：后端 8000 可达", async () => {
    const r = await api("/api/tasks");
    expect(r).toBeDefined();
  });

  it("[0] 启动时无 e2e 任务残留", async () => {
    const rows = await db<{ c: string }[]>("SELECT count(*) AS c FROM task WHERE creator=$1", [SENDER]);
    expect(Number(rows[0].c)).toBe(0);
  });

  it("[1] sdk_message 接受", async () => {
    const r = await send(`李自成 下午办公室讲ppt（批次${RUN}）`, "base");
    expect(r.ok).toBe(true);
  });

  it("[1] 消息已落库", async () => {
    const rows = await db<{ c: string }[]>(
      "SELECT count(*) AS c FROM message WHERE sender_name=$1 AND content LIKE $2",
      [SENDER, `%批次${RUN}%`],
    );
    expect(Number(rows[0].c)).toBeGreaterThanOrEqual(1);
  });

  it("[2] 任务已创建（AI 识别自然语句）", async () => {
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

  it("[4] 防重放：同 clientMsgID 重投不重复入库", async () => {
    await send(`王五 周五前发周报，编号${RUN}`, "replay"); // 同文本同 clientMsgID
    await new Promise((r) => setTimeout(r, 2000));
    const rows = await db<{ c: string }[]>(
      "SELECT count(*) AS c FROM message WHERE sender_name=$1 AND content LIKE $2",
      [SENDER, `%编号${RUN}%`],
    );
    expect(Number(rows[0].c)).toBe(1);
  });

  it("[4] 防重放：重投被闸门拦截", async () => {
    const r = await send(`王五 周五前发周报，编号${RUN}`, "replay");
    expect(r.dedup === true || r.reason === "client_msg_id_seen").toBe(true);
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
