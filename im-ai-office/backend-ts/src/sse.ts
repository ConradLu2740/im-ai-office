import { config } from "./config.js";

// ============ SSE 进程内总线（bus.py fanout/subscribe 的 TS 版） ============

type Sink = (line: string) => void;
const subscribers = new Set<Sink>();

export function subscribe(sink: Sink): void {
  subscribers.add(sink);
}

export function unsubscribe(sink: Sink): void {
  subscribers.delete(sink);
}

/** 进程内 fan-out；订阅者异常直接跳过（允许丢帧，重连全量刷新兜底）。 */
export function fanout(eventType: string, payload: Record<string, unknown> = {}): void {
  const data = JSON.stringify({ type: eventType, ts: Date.now(), ...payload });
  for (const s of [...subscribers]) {
    try { s(data); } catch { /* ignore */ }
  }
}

// ============ 确定性 msgId 去重（event_dedup 表，DB 实现；30 分钟窗口） ============

import { one, query } from "./db.js";

export function deterministicMsgId(convId: string, sender: string, text: string): string {
  // 与 Python 版同构：sha256("conv|sender|text") 前 16 hex，"evt_" 前缀
  return "evt_" + sha256Hex(`${convId}|${sender}|${text}`).slice(0, 16);
}

import { createHash } from "node:crypto";
function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** 30 分钟窗口内的 msgId 视为重复（与 bus.is_duplicate 语义 1:1）。 */
export async function isDuplicate(msgId: string): Promise<boolean> {
  const hit = await one(
    `SELECT 1 FROM event_dedup WHERE msg_id=$1 AND consumed_at > NOW() - ($2 || ' seconds')::interval`,
    [msgId, String(config.dedupWindowSec)]
  );
  return hit !== null;
}

/** 同步路径处理完成：登记 msgId（窗口起点；重复处理时刷新窗口）。 */
export async function markConsumed(msgId: string): Promise<void> {
  await query(
    "INSERT INTO event_dedup(msg_id) VALUES($1) ON CONFLICT (msg_id) DO UPDATE SET consumed_at = NOW()",
    [msgId]
  );
}
