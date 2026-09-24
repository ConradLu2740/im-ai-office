import { Hono } from "hono";
import { requireAdmin, requireUser } from "../deps.js";
import { errText } from "../errtext.js";

import { canDo, decideApproval, getRole, listRoles, listApprovals, requireApproval, setRole } from "../rbac.js";
import { fanout } from "../sse.js";

export const rbacRoutes = new Hono()

  .post("/api/role/set", async (c) => {
  const g = await requireAdmin(c);
  if (g.denied) return g.denied;
  const body = await c.req.json().catch(() => ({}));
  try {
    await setRole(String(body.oim_user_id ?? ""), String(body.role ?? ""));
    return c.json({ ok: true, role: await getRole(String(body.oim_user_id ?? "")) });
  } catch (e) {
    return c.json({ ok: false, error: errText(e) });
  }
})

// M3 前端可视化：角色全量列表（C1 修复：登录可读；写走 requireAdmin）
  .get("/api/roles", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  return c.json({ ok: true, roles: await listRoles(), imAdmin: "group_admin" });
})
  .get("/api/role/:oim_user_id", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  return c.json({ ok: true, role: await getRole(c.req.param("oim_user_id")) });
})
  .get("/api/approvals", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  const status = c.req.query("status") ?? "pending";
  return c.json({ ok: true, approvals: await listApprovals(status) });
})
  .post("/api/approvals/:id/decide", async (c) => {
  const g = await requireAdmin(c);
  if (g.denied) return g.denied;
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const { row, detail } = await decideApproval(id, Boolean(body.approved), g.user!.id);
  if (!row) return c.json({ ok: false, error: "approval not found" });
  // 批准且动作是群通知 → SSE 触达（P3：OpenIM 代发已删除）
  if (body.approved && detail && row.action === "notify_group") {
    fanout("notify_group", { group_id: detail.group_id ?? "", text: detail.text ?? "" });
  }
  return c.json({ ok: true, approval: row });
})
  .post("/api/notify/request", async (c) => {
  // C1 修复：必须登录，且 actor 强制取会话身份（原匿名 + body.actor 可冒名 group_admin 广播）
  const user = await requireUser(c);
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  const actor = user.id;
  const body = await c.req.json().catch(() => ({}));
  try {
    const [ok, why] = await canDo(actor, "assign_notify");
    if (ok && why.startsWith("admin")) {
      fanout("notify_group", { group_id: body.group_id ?? "", text: body.text ?? "" });
      return c.json({ ok: true, direct: true });
    }
    const approvalId = await requireApproval(actor, "notify_group",
      { group_id: body.group_id, text: body.text });
    return c.json({ ok: true, direct: false, approvalId, status: "pending" });
  } catch (e) {
    return c.json({ ok: false, error: errText(e) });
  }
});
