import { defineConfig } from "vitest/config";

// 测试连 imai_test 库（PG-only 策略；guard_pg 先例）。CI/本地均需该库存在。
process.env.DATABASE_URL = process.env.IMAI_TEST_DATABASE_URL
  ?? "postgres://imai:imai_secret@127.0.0.1:5432/imai_test";
process.env.IMAI_REMIND_INTERVAL_SEC = "0";   // 测试禁调度线程，直接调 scan_once

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    // 全部用例共用同一个 imai_test 库：文件级并行会互相 wipeAndSeed（实证：G11 行被邻文件清掉）
    fileParallelism: false,
  },
});
