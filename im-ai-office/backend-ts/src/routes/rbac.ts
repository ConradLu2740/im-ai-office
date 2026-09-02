import { Hono } from "hono";
import { checkAdmin } from "../deps.js";
import { auditLog } from "../repos.js";
import { canDo, decideApproval, getRole, listRoles, listApprovals, requireApproval, setRole } from "../rbac.js";
import { openimClient } from "../openim.js";

export const rbacRoutes = new Hono();

rbacRoutes.post("/api/role/set", async (c) => {
  const denied = checkAdmin(c);
  if (denied) return c.json(denied);
  const body = await c.req.json().catch(() => ({}));
  try {
    await setRole(String(body.oim_user_id ?? ""), String(body.role ?? ""));
    return c.json({ ok: true, role: await getRole(String(body.oim_user_id ?? "")) });
  } catch (e) {
    return c.json({ ok: false, error: String(e).replace("Error: ", "") });
  }
});

// M3 前端可视化：角色全量列表（只读不设防；写仍走 check_admin）
rbacRoutes.get("/api/roles", async (c) => {
  return c.json({ ok: true, roles: await listRoles(), imAdmin: "group_admin" });
});

rbacRoutes.get("/api/role/:oim_user_id", async (c) => {
  return c.json({ ok: true, role: await getRole(c.req.param("oim_user_id")) });
});

rbacRoutes.get("/api/approvals", async (c) => {
  const status = c.req.query("status") ?? "pending";
  return c.json({ ok: true, approvals: await listApprovals(status) });
});

rbacRoutes.post("/api/approvals/:id/decide", async (c) => {
  const denied = checkAdmin(c);
  if (denied) return c.json(denied);
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const { row, detail } = await decideApproval(id, Boolean(body.approved), String(body.decided_by ?? "group_admin"));
  if (!row) return c.json({ ok: false, error: "approval not found" });
  // 批准且动作是群通知 → 真正代发
  if (body.approved && detail && row.action === "notify_group") {
    try {
      await openimClient.sendGroupNotice(String(detail.group_id ?? ""), String(detail.text ?? ""));
    } catch (e) {
      return c.json({ ok: false, error: `approved but send failed: ${e}` });
    }
  }
  return c.json({ ok: true, approval: row });
});

rbacRoutes.post("/api/notify/request", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const actor = String(body.actor ?? "ai");
  try {
    const [ok, why] = await canDo(actor, "assign_notify");
    if (ok && why.startsWith("admin")) {
      await openimClient.sendGroupNotice(String(body.group_id ?? ""), String(body.text ?? ""));
      return c.json({ ok: true, direct: true });
    }
    const approvalId = await requireApproval(actor, "notify_group",
      { group_id: body.group_id, text: body.text });
    return c.json({ ok: true, direct: false, approvalId, status: "pending" });
  } catch (e) {
    return c.json({ ok: false, error: String(e) });
  }
});
void auditLog;
