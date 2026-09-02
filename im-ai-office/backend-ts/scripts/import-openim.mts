// 一次性导入脚本：OpenIM Mongo → PG（app_user / user_group / group_member / user_last_read / grp_meta）
// Spec §4.3：
//   - app_user.id 直接复用 OpenIM userID（身份映射评审 D1，禁另起 id 体系）
//   - user_last_read 初始化为导入时刻各会话 max(message.id)（否则全员历史消息变未读）
//   - 三处一致性校验输出：group_member ↔ person ↔ grp_meta/role + 每用户消息数抽样比对
//   - app_user 口令为占位哈希（不可登录），切换日前用 scripts/set-password.mts 分发真实口令
//
// 用法：cd backend-ts && npx tsx scripts/import-openim.mts
// 前置：Docker Desktop 运行中，OpenIM Mongo 容器名默认 "mongo"（可 MONGO_CONTAINER 覆盖）
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../.env") });
process.env.DATABASE_URL ||= "postgresql://imai:imai_secret@127.0.0.1:5432/imai";

const MONGO_CONTAINER = process.env.MONGO_CONTAINER ?? "mongo";
const pg = await import("pg");
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

/** 从容器 Config.Env 读取 root 凭据（不经 shell、不落日志） */
function mongoCreds(): { user: string; pass: string } {
  const raw = execFileSync("docker", ["inspect", "--format", "{{json .Config.Env}}", MONGO_CONTAINER], { encoding: "utf8" });
  const env = JSON.parse(raw) as string[];
  const get = (k: string) => env.find((e) => e.startsWith(k + "="))?.slice(k.length + 1);
  const user = get("MONGO_INITDB_ROOT_USERNAME");
  const pass = get("MONGO_INITDB_ROOT_PASSWORD");
  if (!user || !pass) throw new Error("容器缺少 MONGO_INITDB_ROOT_USERNAME/PASSWORD");
  return { user, pass };
}

function mongoJson(evalScript: string): unknown {
  const { user, pass } = mongoCreds();
  const out = execFileSync(
    "docker",
    ["exec", MONGO_CONTAINER, "mongosh", "-u", user, "-p", pass,
     "--authenticationDatabase", "admin", "--quiet", "openim_v3", "--eval",
     `print(JSON.stringify(${evalScript}))`],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`mongosh 输出无 JSON：${out.slice(0, 200)}`);
  return JSON.parse(out.slice(start, end + 1));
}

interface MongoUser { user_id: string; nickname: string | null }
interface MongoGroup { group_id: string; group_name: string | null; introduction: string | null; status?: number }
interface MongoMember { group_id: string; user_id: string; join_time: string | null }

async function main(): Promise<void> {
  console.log("=== IMAI · OpenIM Mongo → PG 一次性导入 ===\n[1] 读取 Mongo");
  const data = mongoJson(`(function(){
    const users = db.user.find({user_id: {$ne: "imAdmin"}}, {user_id: 1, nickname: 1}).toArray();
    const groups = db.group.find({status: 0}, {group_id: 1, group_name: 1, introduction: 1}).toArray();
    const members = db.group_member.find({}, {group_id: 1, user_id: 1, join_time: 1}).toArray();
    const groupMsgCounts = {};
    for (const g of groups) {
      const bySender = {};
      const docs = db.msg.find({doc_id: {$regex: g.group_id}}).toArray();
      for (const d of docs) for (const m of (d.msgs||[])) {
        if (!m || !m.msg) continue;
        const s = m.msg.send_id || "?";
        bySender[s] = (bySender[s]||0)+1;
      }
      groupMsgCounts[g.group_id] = bySender;
    }
    return {users, groups, members, groupMsgCounts};
  })()`) as {
    users: MongoUser[]; groups: MongoGroup[]; members: MongoMember[];
    groupMsgCounts: Record<string, Record<string, number>>;
  };
  console.log(`  用户 ${data.users.length}，群 ${data.groups.length}，成员 ${data.members.length}`);

  console.log("\n[2] 写入 PG");
  // 占位哈希（scrypt 格式但随机盐+随机摘要 → 不可登录）；真实口令由 set-password.mts 分发
  const { randomBytes } = await import("node:crypto");
  const placeholderHash = `${randomBytes(16).toString("hex")}:${randomBytes(64).toString("hex")}`;
  for (const u of data.users) {
    await pool.query(
      `INSERT INTO app_user(id, username, display_name, password_hash, role)
       VALUES($1,$2,$3,$4,'member')
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [u.user_id, u.user_id, u.nickname ?? u.user_id, placeholderHash],
    );
    console.log(`  app_user: ${u.user_id}（display_name=${u.nickname ?? u.user_id}，口令为占位，须 set-password 分发）`);
  }
  for (const g of data.groups) {
    await pool.query(
      `INSERT INTO user_group(group_id, name) VALUES($1,$2)
       ON CONFLICT (group_id) DO UPDATE SET name = EXCLUDED.name`,
      [g.group_id, g.group_name],
    );
    console.log(`  user_group: ${g.group_id}（${g.group_name}）`);
  }
  for (const m of data.members) {
    await pool.query(
      `INSERT INTO group_member(group_id, user_id, joined_at)
       VALUES($1,$2, COALESCE($3, NOW()))
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [m.group_id, m.user_id, m.join_time],
    );
  }
  console.log(`  group_member: ${data.members.length} 行（upsert）`);

  // 未读水位：导入时刻各会话 max(message.id)
  for (const g of data.groups) {
    const convId = `sg_${g.group_id}`;
    const { rows } = await pool.query<{ max_id: number | null }>(
      "SELECT MAX(id) AS max_id FROM message WHERE conv_id=$1", [convId]);
    const maxId = rows[0]?.max_id ?? 0;
    const members = data.members.filter((m) => m.group_id === g.group_id);
    for (const m of members) {
      await pool.query(
        `INSERT INTO user_last_read(user_id, conv_id, last_msg_id, updated_at)
         VALUES($1,$2,$3, NOW())
         ON CONFLICT (user_id, conv_id) DO NOTHING`,
        [m.user_id, convId, maxId],
      );
    }
    console.log(`  user_last_read: ${convId} → ${members.length} 人，水位 max(id)=${maxId}`);
  }
  // grp_meta：群简介注入 AI 上下文
  for (const g of data.groups) {
    await pool.query(
      `INSERT INTO grp_meta(oim_group_id, intro, ai_enabled)
       VALUES($1, COALESCE($2, ''), 1)
       ON CONFLICT (oim_group_id) DO UPDATE SET intro = EXCLUDED.intro`,
      [g.group_id, g.introduction ?? ""],
    );
  }

  console.log("\n[3] 一致性校验");
  let hardFail = 0;
  // ① 计数核对
  console.log(`  ① 计数：用户 ${data.users.length} / 群 ${data.groups.length} / 成员 ${data.members.length}`);
  // ② 成员 ⊆ 用户
  const userIds = new Set(data.users.map((u) => u.user_id));
  const orphanMembers = data.members.filter((m) => !userIds.has(m.user_id));
  console.log(`  ② group_member ⊆ app_user：${orphanMembers.length === 0 ? "通过" : `孤儿成员 ${orphanMembers.length}`}`);
  if (orphanMembers.length) hardFail++;
  // ③ 每用户消息数抽样比对（PG vs Mongo，仅群会话）
  for (const g of data.groups) {
    const convId = `sg_${g.group_id}`;
    const { rows } = await pool.query<{ sender_id: string; n: number }>(
      "SELECT sender_id, COUNT(*)::int AS n FROM message WHERE conv_id=$1 GROUP BY sender_id", [convId]);
    const pgCounts = Object.fromEntries(rows.map((r) => [r.sender_id, r.n]));
    for (const [sender, mongoN] of Object.entries(data.groupMsgCounts[g.group_id] ?? {})) {
      const pgN = pgCounts[sender] ?? 0;
      const note = pgN >= mongoN ? "通过（PG 含切流前本地增量）" : `落后 ${mongoN - pgN}`;
      console.log(`  ③ ${convId} ${sender}：Mongo ${mongoN} vs PG ${pgN} → ${note}`);
    }
  }
  // ④ person 身份映射
  const { rows: persons } = await pool.query<{ id: number; real_name: string | null; flower_name: string | null; oim_user_id: string | null }>(
    "SELECT id, real_name, flower_name, oim_user_id FROM person ORDER BY id");
  for (const u of data.users) {
    const matched = persons.find((p) => p.real_name === u.nickname || p.flower_name === u.nickname);
    if (!matched) {
      console.log(`  ④ person 映射：${u.user_id}（${u.nickname}）无 person 行匹配 → 需人工核对`);
      continue;
    }
    if (!matched.oim_user_id) {
      await pool.query("UPDATE person SET oim_user_id=$1 WHERE id=$2", [u.user_id, matched.id]);
      console.log(`  ④ person 映射：person#${matched.id}（${matched.real_name}）← oim_user_id=${u.user_id}（已回填）`);
    } else {
      console.log(`  ④ person 映射：person#${matched.id} oim_user_id=${matched.oim_user_id}（已有）`);
    }
  }
  // ⑤ role / grp_meta 现状
  const { rows: roleRows } = await pool.query("SELECT oim_user_id, role FROM role");
  console.log(`  ⑤ role 表 ${roleRows.length} 行（空=全员默认 member，切流后按需设置）`);

  console.log(`\n=== 导入完成${hardFail ? `（${hardFail} 项硬校验失败）` : "，校验通过"} ===`);
  console.log("提醒：切换日前用 scripts/set-password.mts 为每位用户分发真实口令（Spec §4.3）");
  await pool.end();
  if (hardFail) process.exit(1);
}

main().catch((e) => { console.error("导入失败：", e); process.exit(1); });
