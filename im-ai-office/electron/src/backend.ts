import { spawn, exec, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

// 后端子进程生命周期：spawn / 端口预检 / 退出钩子杀进程树 / crash 退避重启
// 开发：node --import tsx src/index.ts（tsx 经 workspaces 根 node_modules 解析）
// 生产：node dist/index.js（esbuild 产物，依赖全内联，无需 node_modules）

const BASE = "http://127.0.0.1:8000";

export function backendHttpOk(pathname = "/api/roles", timeoutMs = 3000): Promise<boolean> {
  return fetch(BASE + pathname, { signal: AbortSignal.timeout(timeoutMs) })
    .then((r) => r.ok)
    .catch(() => false);
}

/** 找到占用 8000 的 PID（Windows netstat） */
function portPid(): Promise<number | null> {
  return new Promise((resolve) => {
    exec('netstat -ano | findstr ":8000" | findstr "LISTENING"', (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const line = stdout.trim().split("\n")[0];
      const pid = parseInt(line.trim().split(/\s+/).pop() ?? "", 10);
      resolve(Number.isInteger(pid) ? pid : null);
    });
  });
}

/** PID 对应进程名 */
function procName(pid: number): Promise<string> {
  return new Promise((resolve) => {
    exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (err, stdout) => {
      if (err || !stdout) return resolve("");
      const first = stdout.trim().split("\n")[0] ?? "";
      resolve(first.split('","')[0]?.replace(/^"/, "") ?? "");
    });
  });
}

function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    exec(`taskkill /pid ${pid} /T /F`, () => resolve());
  });
}

export interface BackendEnv {
  isPackaged: boolean;
  resourcesPath: string;
}

export class BackendManager {
  private proc: ChildProcess | null = null;
  private restarts = 0;
  private quitting = false;
  /** 端口预检发现的「已在运行的后端」：复用且退出时不清理 */
  adopted = false;

  constructor(private env: BackendEnv) {}

  private nodeExecutable(): string {
    // Electron 的 process.execPath 是 electron.exe，不能当 node 用
    if (process.env.NODE_PATH && fs.existsSync(process.env.NODE_PATH)) return process.env.NODE_PATH;
    if (this.env.isPackaged) {
      const embedded = path.join(this.env.resourcesPath, "backend", "node.exe");
      if (fs.existsSync(embedded)) return embedded; // 内嵌便携 node（分发决策预留）
    }
    return "node"; // 依赖 PATH（dev / 已装 node 的目标机）
  }

  private spawnArgs(): { cmd: string; args: string[]; cwd: string } {
    if (this.env.isPackaged) {
      const res = this.env.resourcesPath;
      return {
        cmd: this.nodeExecutable(),
        args: [path.join(res, "backend", "dist", "index.js")],
        cwd: path.join(res, "backend"),
      };
    }
    const root = path.resolve(__dirname, "..", "..", ".."); // electron/dist → electron → 仓库根
    return {
      cmd: this.nodeExecutable(),
      args: ["--import", "tsx", "src/index.ts"],
      cwd: path.join(root, "backend-ts"),
    };
  }

  /** 启动前端口预检：健康的后端直接复用；被孤儿 node 占用则清理 */
  async precheck(): Promise<"fresh" | "adopted" | "reclaimed"> {
    if (await backendHttpOk()) {
      this.adopted = true;
      return "adopted";
    }
    const pid = await portPid();
    if (pid) {
      const name = await procName(pid);
      if (/node/i.test(name)) {
        await killTree(pid);
        await new Promise((r) => setTimeout(r, 1000));
        return "reclaimed";
      }
      // 非 node 占用（未知进程）→ 不动它，后续启动会失败并报错
    }
    return "fresh";
  }

  async start(): Promise<boolean> {
    if (this.adopted) return true;
    const { cmd, args, cwd } = this.spawnArgs();
    this.proc = spawn(cmd, args, { cwd, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
    this.proc.on("exit", (code) => {
      this.proc = null;
      if (this.quitting) return;
      if (this.restarts < 5) {
        this.restarts += 1;
        const delay = 1000 * 2 ** this.restarts; // crash 退避重启（指数退避，上限 5 次）
        console.log(`[imai-electron] 后端退出(code=${code})，${delay}ms 后第 ${this.restarts} 次重启`);
        setTimeout(() => void this.start(), delay);
      } else {
        console.error("[imai-electron] 后端连续崩溃 5 次，放弃重启");
      }
    });
    // 等健康（最多 60s）
    for (let i = 0; i < 60; i++) {
      if (await backendHttpOk()) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  stop(): void {
    this.quitting = true;
    if (this.adopted) return; // 复用的进程不是我们拉起的，不清理
    const pid = this.proc?.pid;
    if (pid) {
      // Windows：杀进程树，避免「应用关了但 node 进程还在」（交接文档先例）
      exec(`taskkill /pid ${pid} /T /F`, () => {});
    }
  }
}
