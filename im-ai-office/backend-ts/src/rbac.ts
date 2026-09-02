import { desc, eq, sql } from "drizzle-orm";
import { db } from "./db/drizzle.js";
import { approval, role } from "./db/schema.js";
import { auditLog } from "./repos.js";
import { HIGH_RISK_ACTIONS } from "./config.js";

// ============ M3 RBAC（rbac.py 的 TS 版）：角色判定 + 高风险审批 ============

export async function getRole(oimUserId: string): Promise<string> {
  if (oimUserId === "imAdmin") return "group_admin";
  const rows = await db.select({ role: role.role }).from(role).where(eq(role.oimUserId, oimUserId)).limit(1);
  return rows[0]?.role ?? "member";
}

export async function setRole(oimUserId: string, newRole: string): Promise<void> {
  if (!["member", "group_admin"].includes(newRole)) throw new ValueError(`invalid role: ${newRole}`);
  await db.insert(role)
    .values({ oimUserId, role: newRole })
    .onConflictDoUpdate({ target: role.oimUserId, set: { role: newRole, updatedAt: sql`NOW()` } });
  await auditLog("system", "set_role", { oim_user_id: oimUserId, role: newRole });
}

class ValueError extends Error {}

export async function canDo(oimUserId: string, action: string, roleOverride?: string): Promise<[boolean, string]> {
  const r = roleOverride ?? (await getRole(oimUserId));
  if (HIGH_RISK_ACTIONS.has(action)) {
    if (r === "group_admin") return [true, "admin 允许，直接执行"];
    return [false, "require_approval"];
  }
  if (action === "write_board") return [true, "写看板允许"];
  return [true, "default allow"];
}

export async function requireApproval(actor: string, action: string, detail?: Record<string, unknown>): Promise<number> {
  const rows = await db.insert(approval)
    .values({ actor, action, detail: detail ? JSON.stringify(detail) : null, status: "pending" })
    .returning({ id: approval.id });
  await auditLog(actor, "approval_pending", { approvalId: rows[0].id, action, detail });
  return rows[0].id;
}

export async function listApprovals(status = "pending"): Promise<Array<Record<string, unknown>>> {
  const q = db.select().from(approval).$dynamic().orderBy(desc(approval.id));
  if (status) return q.where(eq(approval.status, status));
  return q;
}

export async function listRoles(): Promise<Array<{ oim_user_id: string; role: string; updated_at: string }>> {
  return db.select({
    oim_user_id: role.oimUserId,
    role: role.role,
    updated_at: role.updatedAt,
  }).from(role).orderBy(role.oimUserId) as unknown as Promise<Array<{ oim_user_id: string; role: string; updated_at: string }>>;
}

export async function decideApproval(approvalId: number, approved: boolean, decidedBy: string): Promise<{ row: Record<string, unknown> | null; detail: Record<string, unknown> | null }> {
  const status = approved ? "approved" : "rejected";
  const rows = await db.update(approval)
    .set({ status, decidedAt: sql`NOW()`, decidedBy })
    .where(eq(approval.id, approvalId))
    .returning();
  if (!rows.length) return { row: null, detail: null };
  const row = rows[0] as unknown as Record<string, unknown>;
  let detail: Record<string, unknown> | null = null;
  try { detail = typeof row.detail === "string" ? JSON.parse(row.detail) : (row.detail as Record<string, unknown>); } catch { detail = null; }
  await auditLog(decidedBy, approved ? "approval_approved" : "approval_rejected",
    { approvalId, action: row.action, detail });
  return { row, detail };
}
