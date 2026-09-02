// Electron 主进程入口（临时加载器）：加载 esbuild 产物 dist/main.js
// 生产分发下后端用系统 node 跑 dist/index.js（nodeExecutable() 已预留内嵌便携 node.exe 位），
// 分发策略（内嵌 node vs 依赖目标机安装）在 Task 0.6 Windows 实测后定案。
require("./dist/main.js");
