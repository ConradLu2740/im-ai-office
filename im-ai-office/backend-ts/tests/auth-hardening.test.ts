import { describe, it, expect } from "vitest";
import "./setup.js";

// P0 安全加固：管理端点 fail-closed（env 未设置=拒绝，而非放行）
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
