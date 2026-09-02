// API 层（从 app.ts 摘出，无 @ts-nocheck——API 契约类型全检）
// fetch 分支已接 Hono RPC（hc<AppType>）：路径/方法拼错在编译期由哨兵用例拦截；
// tauriInvoke 分支保留（历史 Tauri 壳兼容，Electron 壳用 preload 白名单不走此路径）。
import { hc } from "hono/client";
import type { AppType } from "../../backend-ts/src/app";

export const API_BASE = "http://127.0.0.1:8000";

const client = hc<AppType>(API_BASE);

declare global {
  interface Window {
    __TAURI__?: { core: { invoke: (cmd: string, args: unknown) => Promise<unknown> } };
  }
}

let tauriInvoke: ((cmd: string, args: unknown) => Promise<unknown>) | null = null;
try { tauriInvoke = window.__TAURI__?.core?.invoke ?? null; } catch { tauriInvoke = null; }

export interface ApiResult { ok?: boolean; error?: string; [k: string]: unknown }

// 会话状态（app.ts 通过 apiSetSession 桥接；本模块内部 _relogin 使用）
let currentUser: string | null = null;
let _reloginInFlight: Promise<boolean> | null = null;

export function apiSetSession(user: string | null, token: string | null): void {
  currentUser = user;
  if (token !== null) {
    try { localStorage.setItem("imai_token", token); } catch { /* 隐私模式 */ }
  }
}

async function _relogin(): Promise<boolean> {
  // 静默重签 token（/openim/login 当前无口令）；单飞防并发重放。
  if (!currentUser) return false;
  if (!_reloginInFlight) {
    _reloginInFlight = (async () => {
      try {
        const res = await _rawApi("/openim/login", { method: "POST", body: JSON.stringify({ user_id: currentUser }) }) as ApiResult;
        if (res && res.ok && res.token) {
          try { localStorage.setItem("imai_token", String(res.token)); } catch { /* 隐私模式 */ }
          return true;
        }
      } catch { /* 忽略 */ }
      return false;
    })();
  }
  const ok = await _reloginInFlight;
  _reloginInFlight = null;
  return ok;
}

interface ApiOpts { method?: string; body?: string | null; headers?: Record<string, string> }

/** hc 动态派发：路径含 ?query 时拆给 { query }；运行时返回 Response → 解析 JSON */
async function hcDispatch(path: string, method: string, body?: unknown): Promise<unknown> {
  const [p, qs] = path.split("?");
  const query: Record<string, string> = {};
  if (qs) for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  const c = (client as unknown as Record<string, {
    $get?: (a?: unknown) => Promise<Response>;
    $post?: (a?: unknown) => Promise<Response>;
    $patch?: (a?: unknown) => Promise<Response>;
    $delete?: (a?: unknown) => Promise<Response>;
  }>)[p];
  if (!c) throw new Error(`unknown api path: ${p}`);
  const base = Object.keys(query).length ? { query } : {};
  let res: Response;
  if (method === "GET") res = await c.$get!(base);
  else if (method === "POST") res = await c.$post!(body !== undefined ? { ...base, json: body } : base);
  else if (method === "PATCH") res = await c.$patch!(body !== undefined ? { ...base, json: body } : base);
  else if (method === "DELETE") res = await c.$delete!(base);
  else throw new Error(`unsupported method: ${method}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function _rawApi(path: string, opts: ApiOpts = {}): Promise<unknown> {
  const method = (opts.method || "GET").toUpperCase();
  let body: unknown;
  if (opts.body) {
    try { body = JSON.parse(opts.body); } catch { body = opts.body; }
  }
  if (tauriInvoke) {
    try {
      return await tauriInvoke("api_call", { method, path, body });
    } catch (e) {
      throw new Error(`${e} (${path})`);
    }
  }
  return await hcDispatch(path, method, body);
}

export async function api(path: string, opts: ApiOpts = {}, _retried = false): Promise<ApiResult> {
  let res;
  try {
    res = await _rawApi(path, opts) as ApiResult;
  } catch (e) {
    // 网络层失败且疑似登录态问题：重签一次再试
    if (!_retried && currentUser && /token|登录|auth/i.test(String(e))) {
      if (await _relogin()) return api(path, opts, true);
    }
    throw e;
  }
  // 业务层失败且疑似 token 失效：静默重签后重试原请求一次
  if (!_retried && res && res.ok === false && /token/i.test(res.error || "")) {
    if (await _relogin()) return api(path, opts, true);
  }
  return res;
}
