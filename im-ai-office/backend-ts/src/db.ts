import { Pool, types as pgTypes, type QueryResultRow } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { db } from "./db/drizzle.js";
import { pool } from "./db/pool.js";

// int8/numeric 以 number 返回（对齐 psycopg2 行为；否则 task.id 变字符串，前端严格比较会翻车）
pgTypes.setTypeParser(20, (v) => parseInt(v, 10));   // int8
pgTypes.setTypeParser(1700, (v) => parseFloat(v));   // numeric

// PG-only：双方言税随重写消亡（后端TS重写迁移Spec §1）
// Pool 实体在 src/db/pool.ts（避免与 drizzle 实例循环依赖）；此文件保持既有导入路径 ./db.js 兼容
export { pool };

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

const SEED_PERSONS: Array<[number, string, string, string, number]> = [
  [1, "张伟", "小张", "产品经理", 100],
  [2, "张敏", "小张", "市场专员", 100],
  [3, "李娜", "娜姐", "运营", 100],
];
const SEED_ALIASES: Array<[number, string]> = [
  [1, "小张"], [1, "张伟"], [2, "小张"], [2, "张敏"], [3, "娜姐"], [3, "李娜"],
];

/**
 * 建表职责已移交 drizzle 迁移（backend-ts/drizzle/，journal 记录在库内）：
 * 空库跑全量迁移建表；已对齐库（生产 imai）no-op。手写 POSTGRES_SCHEMA 退役。
 */
export async function initSchema(): Promise<void> {
  const migrationsFolder = path.resolve(import.meta.dirname, "../drizzle");
  if (fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
    await migrate(db, { migrationsFolder });
  } else {
    // 打包布局下迁移文件夹缺失不应致命（表已由迁移管理/快照预置）
    console.warn("[imai-ts] drizzle 迁移文件夹不存在，跳过 migrate（假设 schema 已就绪）");
  }
  // 种子（与 Python 版 conftest 对齐）
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
    "user_last_read", "group_member", "user_group", "session", "app_user",
    "grp_meta", "term", "approval", "role", "message", "ai_dm", "audit", "task", "alias", "person"];
  for (const t of tables) await pool.query(`DELETE FROM ${t}`);
  await initSchema();
}
