import { spawn, exec, execFile, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";

// 后端子进程生命周期：spawn / 端口预检 / 退出钩子杀进程树 / crash 退避重启
// 开发：node --import tsx src/index.ts（tsx 经 workspaces 根 node_modules 解析）
// 生产：node dist/index.js（esbuild 产物，依赖全内联，无需 node_modules）

const BASE = "http://127.0.0.1:8000";
const PG_HOME = process.env.IMAI_PG_HOME ?? "C:\\imai";   // Windows 原生 PG 安装根（pgdata/pgsql）
const PG_PORT = 5432;

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

function portOpen(port: number, host = "127.0.0.1", timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.setTimeout(timeoutMs);
    s.on("connect", () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    s.on("timeout", () => { s.destroy(); resolve(false); });
  });
}

/**
 * 确保 PostgreSQL 运行（开机自启链路的关键一环：IMAI.exe 自启 → PG → 后端）。
 * 2026-09-03 实测：PG Windows 服务开机启动失败（0xC0000142）且无兑底，后端连不上库反复崩溃。
 * 检测 5432 未监听 → pg_ctl start → 轮询就绪（最多 30s）。非 Windows / pg_ctl 缺失时跳过。
 */
async function ensurePostgres(): Promise<void> {
  if (process.platform !== "win32") return;
  if (await portOpen(PG_PORT)) return;
  const pgCtl = path.join(PG_HOME, "pgsql", "bin", "pg_ctl.exe");
  const pgData = path.join(PG_HOME, "pgdata");
  const pgLog = path.join(PG_HOME, "pglog.txt");
  if (!fs.existsSync(pgCtl) || !fs.existsSync(pgData)) {
    console.warn(`[imai-electron] PG 未运行且未找到 ${pgCtl}，跳过自动启动`);
    return;
  }
  console.log("[imai-electron] PostgreSQL 未运行，pg_ctl start...");
  await new Promise<void>((resolve) => {
    execFile(pgCtl, ["-D", pgData, "-l", pgLog, "start"], { timeout: 45000 }, (err) => {
      if (err) console.warn("[imai-electron] pg_ctl start 异常：", String(err).slice(0, 200));
      resolve();
    });
  });
  for (let i = 0; i < 30; i++) {
    if (await portOpen(PG_PORT)) {
      console.log(`[imai-electron] PostgreSQL 已就绪（等待 ${i + 1}s）`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("[imai-electron] PostgreSQL 30s 未就绪，后端可能无法连接数据库");
}

export interface BackendEnv {
  isPackaged: boolean;
  resourcesPath: string;
  /** 打包态后端日志文件（dev 用 inherit 走控制台） */
  logFile?: string;
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
    if (process.platform === "win32") {
      // 显式绝对路径优先：Git Bash/msys 环境下 PATH 是 /c/... 格式，spawn("node") 会 ENOENT
      const pfNode = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node.exe");
      if (fs.existsSync(pfNode)) return pfNode;
    }
    return "node"; // 依赖 PATH
  }

  private spawnArgs(): { cmd: string; args: string[]; cwd: string; stdio: "ignore" | "inherit" } {
    if (this.env.isPackaged) {
      const res = this.env.resourcesPath;
      // cwd 与 dev（backend-ts）同构：serveStatic 的 ../web → backend/web，dotenv 的 ../../.env → resources/.env
      return {
        cmd: this.nodeExecutable(),
        args: [path.join(res, "backend", "dist", "index.js")],
        cwd: path.join(res, "backend", "dist"),
        stdio: "ignore",
      };
    }
    const root = path.resolve(__dirname, "..", ".."); // electron/dist → electron → im-ai-office（仓库根）
    return {
      cmd: this.nodeExecutable(),
      args: ["--import", "tsx", "src/index.ts"],
      cwd: path.join(root, "backend-ts"),
      stdio: "inherit",
    };
  }

  /** 启动后端前先确保 PostgreSQL 运行（开机自启链路兑底），然后端口预检 */
  async precheck(): Promise<"fresh" | "adopted" | "reclaimed"> {
    await ensurePostgres();
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
    const { cmd, args, cwd, stdio } = this.spawnArgs();
    let stdioTarget: ("ignore" | "inherit" | number)[] = ["ignore", stdio, stdio];
    if (this.env.isPackaged && this.env.logFile) {
      fs.mkdirSync(path.dirname(this.env.logFile), { recursive: true });
      const fd = fs.openSync(this.env.logFile, "a");
      stdioTarget = ["ignore", fd, fd];
    }
    this.proc = spawn(cmd, args, { cwd, stdio: stdioTarget, windowsHide: true });
    this.proc.on("error", (e) => console.warn("[imai-electron] 后端进程 spawn 异常：", String(e).slice(0, 200)));
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
    // 等健康（最多 60s）；超时则杀掉卡死的后端进程，交由 exit 退避重启（此时 PG 可能刚被拉起）
    for (let i = 0; i < 60; i++) {
      if (await backendHttpOk()) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.error("[imai-electron] 后端启动超时（60s），杀掉进程重试");
    const stuck = this.proc;
    this.proc = null;
    if (stuck?.pid) {
      this.quitting = false;
      exec(`taskkill /pid ${stuck.pid} /T /F`, () => {});
      // exit 事件触发退避重启
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
