import { contextBridge, ipcRenderer } from "electron";

// 白名单 IPC：渲染层 window.imai.ipc.invoke(channel, payload)
// api_call 平移自 Tauri：主进程 fetch 8000（UTF-8 原生，无 GBK 编码问题）
const ALLOWED_CHANNELS = new Set(["api_call", "notify", "backend_health"]);

contextBridge.exposeInMainWorld("imai", {
  ipc: {
    invoke(channel: string, payload?: unknown): Promise<unknown> {
      if (!ALLOWED_CHANNELS.has(channel)) {
        return Promise.reject(new Error(`IPC channel 不在白名单: ${channel}`));
      }
      return ipcRenderer.invoke(channel, payload);
    },
  },
});
