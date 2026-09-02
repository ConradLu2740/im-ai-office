import dotenv from "dotenv";
import path from "node:path";
import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";

// 与 src/config.ts 同源：加载仓库根 .env（默认生产 imai 库）；测试库用 IMAI_TEST_DATABASE_URL 覆盖
// drizzle-kit 的配置加载器里 import.meta.dirname 可能为 undefined，双路径兜底
const here = (() => {
  try { return import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url)); }
  catch { return process.cwd(); }
})();
dotenv.config({ path: path.resolve(here, "../../.env") });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.IMAI_TEST_DATABASE_URL
      ?? process.env.DATABASE_URL
      ?? "postgresql://imai:imai_secret@127.0.0.1:5432/imai",
  },
  verbose: true,
  strict: true,
});
