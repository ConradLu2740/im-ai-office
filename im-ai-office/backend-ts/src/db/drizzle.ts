import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "./pool.js";
import * as schema from "./schema.js";

// Drizzle 实例：复用共享 pg Pool（连接配置/类型解析器与现状一致）
export const db = drizzle(pool, { schema });

export { schema };
