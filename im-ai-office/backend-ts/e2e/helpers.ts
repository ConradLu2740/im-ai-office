import { Pool } from "pg";

// E2E 直连真实环境：BASE 默认本机 8000；PG 校验连生产 imai 库（与 acceptance.py 同 DSN）
export const BASE = process.env.IMAI_E2E_BASE ?? "http://localhost:8000";
const DSN =
  process.env.IMAI_E2E_DATABASE_URL ?? "postgresql://imai:imai_secret@127.0.0.1:5432/imai";

export const pool = new Pool({ connectionString: DSN, max: 2 });

export async function db<T = unknown[][]>(sql: string, args: unknown[] = []): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SET TIME ZONE 'Asia/Shanghai'");
    const res = await client.query(sql, args);
    return (res.rows ?? []) as T;
  } finally {
    client.release();
  }
}

export async function api(
  path: string,
  payload?: unknown,
  method?: "GET" | "POST" | "DELETE",
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(BASE + path, {
    method: method ?? (payload ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...headers },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return (await res.json()) as Record<string, unknown>;
}

/** 简单字符串哈希（模拟 python hash(text)%99999 的唯一尾缀作用） */
export function strHash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 99999;
}

/** 轮询直到 fn 返回真值或超时（毫秒） */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeout = 30000,
  interval = 2000,
): Promise<T | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, interval));
  }
  return null;
}
