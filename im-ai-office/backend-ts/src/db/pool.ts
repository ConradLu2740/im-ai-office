import { Pool, types as pgTypes } from "pg";
import { config } from "../config.js";

// int8/numeric 以 number 返回（对齐 psycopg2 行为；否则 task.id 变字符串，前端严格比较会翻车）
pgTypes.setTypeParser(20, (v) => parseInt(v, 10));   // int8
pgTypes.setTypeParser(1700, (v) => parseFloat(v));   // numeric

// PG-only：双方言税随重写消亡（后端TS重写迁移Spec §1）
// 独立模块避免 db.ts ↔ drizzle.ts 循环依赖
export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
