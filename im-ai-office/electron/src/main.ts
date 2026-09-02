import { app, BrowserWindow, Tray, Menu, Notification, ipcMain } from "electron";
import path from "node:path";
import { BackendManager, backendHttpOk, type BackendEnv } from "./backend";

// IMAI Electron 壳：后端生命周期 / 窗口 / 托盘未读 / 系统通知 / 开机自启
// 安全基线：contextIsolation:true、nodeIntegration:false、preload 白名单 IPC（api_call 平移）

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const env: BackendEnv = { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath };
const backend = new BackendManager(env);
const APP_URL = "http://127.0.0.1:8000/";

const NOTIFY_EVENT_TYPES = new Set(["task_created", "reminder", "digest", "ai.card"]);

function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "..", "icons", "icon.png");
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "IMAI 办公助手",
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(APP_URL).catch(() => {
    // 后端未就绪时 10s 后重试一次
    setTimeout(() => void win?.loadURL(APP_URL), 10000);
  });
  // 点关闭 = 最小化到托盘（退出走托盘菜单 / before-quit）
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

/** 托盘：点击显示窗口；tooltip 展示未读角标数 */
async function setupTray(): Promise<void> {
  tray = new Tray(iconPath());
  tray.setToolTip("IMAI 办公助手");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示主窗口", click: () => { win?.show(); win?.focus(); } },
      { type: "separator" },
      { label: "退出", click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.on("click", () => { win?.show(); win?.focus(); });
}

/** 未读角标：/api/ai_dm unread + /api/tasks pending（30s 轮询） */
async function refreshBadge(): Promise<void> {
  if (!tray) return;
  try {
    const dm = (await (await fetch("http://127.0.0.1:8000/api/ai_dm?sender_id=user001")).json()) as { unread?: number };
    const tasks = (await (await fetch("http://127.0.0.1:8000/api/tasks")).json()) as unknown;
    const pending = Array.isArray(tasks)
      ? (tasks as { status?: string }[]).filter((t) => t.status === "pending_confirmation" || t.status === "pending_assignee").length
      : 0;
    const n = (dm.unread ?? 0) + pending;
    tray.setToolTip(n > 0 ? `IMAI 办公助手（未读/待办 ${n}）` : "IMAI 办公助手");
    tray.setImage(iconPath());
  } catch { /* 后端未就绪，忽略 */ }
}

/** 通知桥：主进程直连后端 SSE，task_created/reminder/digest/ai.card → 系统通知 */
async function sseNotifyBridge(): Promise<void> {
  for (;;) {
    try {
      if (!(await backendHttpOk("/api/events/stream", 2000))) {
        await new Promise((r) => setTimeout(r, 15000));
        continue;
      }
      const res = await fetch("http://127.0.0.1:8000/api/events/stream");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim()) as { type?: string; title?: string; text?: string };
            if (evt.type && NOTIFY_EVENT_TYPES.has(evt.type) && Notification.isSupported()) {
              new Notification({
                title: evt.title ?? "IMAI 提醒",
                body: evt.text ?? evt.type,
                icon: iconPath(),
              }).show();
            }
          } catch { /* 非 JSON 行，忽略 */ }
        }
      }
    } catch { /* 断线重连 */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** IPC 白名单实现（preload 只暴露 invoke(channel, payload)，此处统一校验） */
function setupIpc(): void {
  ipcMain.handle("api_call", async (_e, payload: { method?: string; path?: string; body?: unknown }) => {
    const method = (payload?.method ?? "GET").toUpperCase();
    const p = String(payload?.path ?? "");
    if (!p.startsWith("/api/")) throw new Error("仅允许 /api/ 路径");
    const allowedMethods = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);
    if (!allowedMethods.has(method)) throw new Error(`不支持的 method: ${method}`);
    const res = await fetch(`http://127.0.0.1:8000${p}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload?.body ? JSON.stringify(payload.body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    return JSON.parse(text);
  });
  ipcMain.handle("notify", (_e, payload: { title?: string; body?: string }) => {
    if (Notification.isSupported()) {
      new Notification({ title: payload?.title ?? "IMAI", body: payload?.body ?? "", icon: iconPath() }).show();
    }
    return true;
  });
  ipcMain.handle("backend_health", async () => ({ running: await backendHttpOk() }));
}

app.on("before-quit", () => {
  quitting = true;
  backend.stop();
});

app.whenReady().then(async () => {
  setupIpc();

  // 开机自启（仅打包态；dev 不污染登录项）
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAsHidden: true });
  }

  const mode = await backend.precheck();
  console.log(`[imai-electron] 端口预检：${mode}`);
  if (mode !== "adopted") {
    const ok = await backend.start();
    if (!ok) console.error("[imai-electron] 后端启动超时（60s）");
  }

  await setupTray();
  createWindow();
  void refreshBadge();
  setInterval(refreshBadge, 30000);
  void sseNotifyBridge();
});

app.on("window-all-closed", () => {
  // 托盘应用：保持运行（退出走托盘菜单）
});
