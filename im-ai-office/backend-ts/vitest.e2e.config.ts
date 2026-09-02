import { defineConfig } from "vitest/config";

// acceptance E2E 专用配置：打真实环境（后端 8000 + 生产 imai 库 + 真实 LLM）
// 单元测试用默认 vitest.config.ts（imai_test 库），两者分离互不影响。
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.test.ts"],
    testTimeout: 60000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
