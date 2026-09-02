// 口令设置工具（Spec §4.3：切流日前分发）：
//   npx tsx scripts/set-password.mts <username> <password> [user_id] [display_name]
// 用户存在 → 改密；不存在且提供 user_id → 建号（id 复用 OpenIM userID）。
import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../.env", import.meta.url).pathname.replace(/^\/(\w:)/, "$1") });
process.env.DATABASE_URL ||= "postgresql://imai:imai_secret@127.0.0.1:5432/imai";
const [, , username, password, userId, displayName] = process.argv;
if (!username || !password) {
  console.error("用法: npx tsx scripts/set-password.mts <username> <password> [user_id] [display_name]");
  process.exit(1);
}
const { upsertPassword } = await import("../src/auth.js");
const r = await upsertPassword(username, password, userId, displayName);
console.log(r.created ? `已创建 ${username} (id=${r.user_id})` : `已更新 ${username} 口令 (id=${r.user_id})`);
process.exit(0);
