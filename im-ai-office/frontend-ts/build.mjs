import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

// 构建产物直接落到 ../web/（后端静态目录 + Tauri frontendDist 共用），单一产物来源
const outDir = path.resolve(import.meta.dirname, "../web");
const watch = process.argv.includes("--watch");

fs.mkdirSync(outDir, { recursive: true });

// 静态资源：index.html / styles.css 单一来源在 frontend-ts/static
for (const f of ["index.html", "styles.css"]) {
  fs.copyFileSync(path.resolve(import.meta.dirname, "static", f), path.join(outDir, f));
}

const options = {
  entryPoints: ["src/app.ts"],
  bundle: true,
  outfile: path.join(outDir, "app.js"),
  format: "iife",
  target: ["es2022"],
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[frontend] watch 模式：改 src/ 即自动重建到 ../web/");
} else {
  await esbuild.build(options);
  console.log("[frontend] 构建完成 → ../web/app.js");
}
