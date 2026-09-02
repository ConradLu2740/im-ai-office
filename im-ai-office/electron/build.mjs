import esbuild from "esbuild";

// Electron 主进程/preload 打包：CJS + external electron（runtime 由 Electron 提供）
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: ["node20"],
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
};

await esbuild.build({
  ...common,
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
});
await esbuild.build({
  ...common,
  entryPoints: ["src/preload.ts"],
  outfile: "dist/preload.js",
});
console.log("[electron] 构建完成 → dist/main.js + dist/preload.js");
