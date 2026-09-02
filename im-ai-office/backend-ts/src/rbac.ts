import { one, query } from "./db.js";
import { auditLog } from "./repos.js";
import { HIGH_RISK_ACTIONS } from "./config.js";

// ============ M3 RBAC（rbac.py 的 TS 版）：角色判定 + 高风险审批 ============

export async function getRole(oimUserId: string): Promise<string> {
  if (oimUserId === "imAdmin") return "group_admin";
  const row = await one<{ role: string }>("SELECT role FROM role WHERE oim_user_id=$1", [oimUserId]);
  return row?.role ?? "member";
}

export async function setRole(oimUserId: string, role: string): Promise<void> {
  if (!["member", "group_admin"].includes(role)) throw new ValueError(`invalid role: ${role}`);
  await query(
    "INSERT INTO role(oim_user_id, role) VALUES($1,$2) " +
    "ON CONFLICT(oim_user_id) DO UPDATE SET role=EXCLUDED.role, updated_at=NOW()",
    [oimUserId, role]);
  await auditLog("system", "set_role", { oim_user_id: oimUserId, role });
}

class ValueError extends Error {}

export async function canDo(oimUserId: string, action: string, role?: string): Promise<[boolean, string]> {
  role = role ?? (await getRole(oimUserId));
  if (HIGH_RISK_ACTIONS.has(action)) {
    if (role === "group_admin") return [true, "admin 允许，直接执行"];
    return [false, "require_approval"];
  }
  if (action === "write_board") return [true, "写看板允许"];
  return [true, "default allow"];
}

export async function requireApproval(actor: string, action: string, detail?: Record<string, unknown>): Promise<number> {
  const id = await query<{ id: number }>(
    "INSERT INTO approval(actor,action,detail,status) VALUES($1,$2,$3,'pending') RETURNING id",
    [actor, action, detail ? JSON.stringify(detail) : null]);
  await auditLog(actor, "approval_pending", { approvalId: id[0].id, action, detail });
  return id[0].id;
}

export async function listApprovals(status = "pending"): Promise<Array<Record<string, unknown>>> {
  if (status) return query("SELECT * FROM approval WHERE status=$1 ORDER BY id DESC", [status]);
  return query("SELECT * FROM approval ORDER BY id DESC");
}

export async function listRoles(): Promise<Array<{ oim_user_id: string; role: string; updated_at: string }>> {
  return query("SELECT oim_user_id, role, updated_at FROM role ORDER BY oim_user_id");
}

export async function decideApproval(approvalId: number, approved: boolean, decidedBy: string): Promise<{ row: Record<string, unknown> | null; detail: Record<string, unknown> | null }> {
  const status = approved ? "approved" : "rejected";
  const row = await one<Record<string, unknown>>(
    "UPDATE approval SET status=$1, decided_at=NOW(), decided_by=$2 WHERE id=$3 RETURNING *",
    [status, decidedBy, approvalId]);
  if (!row) return { row: null, detail: null };
  let detail: Record<string, unknown> | null = null;
  try { detail = typeof row.detail === "string" ? JSON.parse(row.detail) : (row.detail as Record<string, unknown>); } catch { detail = null; }
  await auditLog(decidedBy, approved ? "approval_approved" : "approval_rejected",
    { approvalId, action: row.action, detail });
  return { row, detail };
}
