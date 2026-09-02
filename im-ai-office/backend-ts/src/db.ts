import { Pool, types as pgTypes, type QueryResultRow } from "pg";
import { config } from "./config.js";

// int8/numeric 以 number 返回（对齐 psycopg2 行为；否则 task.id 变字符串，前端严格比较会翻车）
pgTypes.setTypeParser(20, (v) => parseInt(v, 10));   // int8
pgTypes.setTypeParser(1700, (v) => parseFloat(v));   // numeric

// PG-only：双方言税随重写消亡（后端TS重写迁移Spec §1）
export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export type Row = QueryResultRow;

/** 查询：pg 的 ? 占位用 $n，这里统一封装返回行数组。 */
export async function query<T extends QueryResultRow = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query<T>(sql, params);
  return r.rows;
}

export async function one<T extends QueryResultRow = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** INSERT ... RETURNING id 的取值。 */
export async function insertReturningId(sql: string, params: unknown[] = []): Promise<number> {
  const r = await pool.query<{ id: number }>(sql, params);
  return Number(r.rows[0].id);
}

export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS person(id BIGSERIAL PRIMARY KEY, real_name TEXT, flower_name TEXT, title TEXT, group_id INTEGER);
CREATE TABLE IF NOT EXISTS alias(person_id INTEGER, name TEXT);
CREATE TABLE IF NOT EXISTS task(id BIGSERIAL PRIMARY KEY, content TEXT, creator TEXT,
                  assignee TEXT, deadline TEXT, deadline_at TIMESTAMPTZ,
                  status TEXT, confidence TEXT, source_msg TEXT, pending_meta TEXT,
                  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS audit(id BIGSERIAL PRIMARY KEY, actor TEXT, action TEXT, detail TEXT, ts TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS ai_dm(id BIGSERIAL PRIMARY KEY, sender_id TEXT, direction TEXT, content TEXT, task_id INTEGER, read_flag INTEGER DEFAULT 0, ts TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS message(id BIGSERIAL PRIMARY KEY, conv_id TEXT, sender_id TEXT, sender_name TEXT, content TEXT, content_type INTEGER DEFAULT 101, is_self INTEGER DEFAULT 0, msg_seq INTEGER, client_msg_id TEXT, ts TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS role(oim_user_id TEXT PRIMARY KEY, role TEXT DEFAULT 'member', updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS approval(id BIGSERIAL PRIMARY KEY, actor TEXT, action TEXT, detail TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), decided_at TIMESTAMPTZ, decided_by TEXT);
CREATE TABLE IF NOT EXISTS term(id BIGSERIAL PRIMARY KEY, term TEXT UNIQUE NOT NULL, meaning TEXT NOT NULL, source TEXT DEFAULT 'manual', created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS grp_meta(oim_group_id TEXT PRIMARY KEY, intro TEXT DEFAULT '', ai_enabled INTEGER DEFAULT 1, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS event_dedup(msg_id TEXT PRIMARY KEY, consumed_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS reminder_sent(id BIGSERIAL PRIMARY KEY, task_id INTEGER, tier TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(task_id, tier));
CREATE TABLE IF NOT EXISTS digest_sent(digest_date TEXT PRIMARY KEY, count INTEGER, pushed_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS minutes(id BIGSERIAL PRIMARY KEY, conv_id TEXT, title TEXT, summary TEXT,
                   decisions TEXT, action_items TEXT, msg_count INTEGER DEFAULT 0,
                   created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS mine_candidate(id BIGSERIAL PRIMARY KEY, conv_id TEXT, kind TEXT,
                     payload TEXT, evidence TEXT, msg_count INTEGER DEFAULT 0,
                     status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(),
                     decided_at TIMESTAMPTZ, decided_by TEXT);
`;

const SEED_PERSONS: Array<[number, string, string, string, number]> = [
  [1, "张伟", "小张", "产品经理", 100],
  [2, "张敏", "小张", "市场专员", 100],
  [3, "李娜", "娜姐", "运营", 100],
];
const SEED_ALIASES: Array<[number, string]> = [
  [1, "小张"], [1, "张伟"], [2, "小张"], [2, "张敏"], [3, "娜姐"], [3, "李娜"],
];

export async function initSchema(): Promise<void> {
  for (const stmt of POSTGRES_SCHEMA.split(";")) {
    const s = stmt.trim();
    if (s) await pool.query(s);
  }
  // 幂等补列（生产旧库缺列——本次重写实战踩坑：task 缺 pending_meta 导致歧义流 500）。
  // 与 Python 版不同：PG 侧也做轻量迁移，不再依赖“老表恰好齐列”。
  const migrations = [
    "ALTER TABLE task ADD COLUMN IF NOT EXISTS pending_meta TEXT",
    "ALTER TABLE message ADD COLUMN IF NOT EXISTS client_msg_id TEXT",
    "ALTER TABLE ai_dm ADD COLUMN IF NOT EXISTS task_id INTEGER",
    "ALTER TABLE ai_dm ADD COLUMN IF NOT EXISTS read_flag INTEGER DEFAULT 0",
  ];
  for (const m of migrations) await pool.query(m);
  const { rows } = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM person");
  if (Number(rows[0].n) === 0) {
    for (const [id, real, flower, title, gid] of SEED_PERSONS) {
      await pool.query("INSERT INTO person(id, real_name, flower_name, title, group_id) VALUES($1,$2,$3,$4,$5)", [id, real, flower, title, gid]);
    }
    for (const [pid, name] of SEED_ALIASES) {
      await pool.query("INSERT INTO alias(person_id, name) VALUES($1,$2)", [pid, name]);
    }
  }
}

/** 测试基座：清空全部业务表 + 重建种子（对齐 conftest.fresh_db）。 */
export async function wipeAndSeed(): Promise<void> {
  const tables = ["mine_candidate", "minutes", "digest_sent", "reminder_sent", "event_dedup",
    "grp_meta", "term", "approval", "role", "message", "ai_dm", "audit", "task", "alias", "person"];
  for (const t of tables) await pool.query(`DELETE FROM ${t}`);
  await initSchema();
}
