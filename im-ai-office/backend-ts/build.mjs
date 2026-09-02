import esbuild from "esbuild";
import path from "node:path";

// 后端单文件打包：src/index.ts → dist/index.js
// platform=node；pg/zod/hono/@hono/node-server 均为纯 JS，无原生模块，全部内联——
// 产物仅需 node 可执行文件即可运行，不依赖 node_modules（Electron 分发的前提）。
await esbuild.build({
  entryPoints: [path.resolve(import.meta.dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: ["node22"],
  format: "esm",
  outfile: path.resolve(import.meta.dirname, "dist/index.js"),
  // esbuild ESM 产物中被打包的 CJS 依赖（如 dotenv）会动态 require——注入 createRequire shim 兜底
  banner: {
    js: `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);`,
  },
  minify: false,
  sourcemap: true,
  logLevel: "info",
});
console.log("[backend] 构建完成 → dist/index.js");
