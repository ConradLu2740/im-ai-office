// 类型已全量收紧（2026-09-03）：移除 @ts-nocheck，DOM 窄化/unknown 收敛完成。
// API 层已摘出至 api.ts（无 @ts-nocheck，Hono RPC 契约全检）。

import { api, apiSetSession, getTauriInvoke, type ApiResult } from "./api.js";

window.onerror = function (msg: string | Event, src?: string, line?: number) {
  document.documentElement.setAttribute("data-jserr", String(msg).slice(0,200) + " @" + String(src||"").split("/").pop() + ":" + line);
};
// 同源部署（如后端静态直出预览）时走同源 API，避免跨源；Tauri/file:// 与 8000 端口场景仍用绝对地址
const API_BASE = (location.protocol.startsWith("http") && location.port && location.port !== "8000") ? "" : "http://127.0.0.1:8000";
const fmt = (s: unknown) => (s == null ? "—" : String(s));

// 当前登录状态（镜像；API 层会话见 api.ts apiSetSession）
type ConvState = { id: string; targetId?: string; name?: string; type: number | string };
let currentUser: string | null = null;
let currentToken: string | null = null;
let currentConversation: ConvState | null = null;

// ============ 角标 / 顶栏状态（UI 骨架 v2 Task 10/11，跨函数共享） ============
let _taskPending = 0;   // 待确认 + 待指派（任务角标 / pill 主动态），loadTasks 维护
let _chatUnread = 0;    // 群聊未读总数（/api/messages/unread 全量 + SSE 增量），loadConversations 维护
let _aiUnread = 0;      // AI 助手未读（/api/ai_dm），updateAIUnread 维护
let _pillBusy = false;  // 工作态：发送消息等待 AI 响应中


function showToast(msg: string, ok = true) {
  let box = document.getElementById("toastBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "toastBox";
    box.style.cssText = "position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:99998;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.style.cssText = `background:${ok ? "#1a9e6c" : "#d64550"};color:#fff;padding:8px 16px;border-radius:10px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;transition:opacity .2s;max-width:70vw;`;
  t.textContent = msg;
  box.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = "1"; });
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 260); }, 2200);
}

function fmtTime(ts: string | number | null | undefined) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts).replace("T", " ").slice(5, 16);
  const now = new Date();
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return hm;
  if (d.toDateString() === yest.toDateString()) return "昨天 " + hm;
  return String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + hm;
}

function logDebug(info: unknown) {
  const card = document.createElement("div");
  card.className = "ai-card";
  card.innerHTML = "<b>🐞 诊断信息</b><pre style='font-size:11px;color:#5a6482;'>" + JSON.stringify(info, null, 2) + "</pre>";
  document.getElementById("messages").appendChild(card);
}

// UI 骨架 v2 Task 10：导航角标。task = 待确认+待指派；chat = 群聊未读 + AI 助手未读；0 隐藏
function updateBadges(taskPending: number, chatUnread: number) {
  _taskPending = taskPending;
  _chatUnread = chatUnread;
  const bt = document.getElementById("bdg-task");
  const bc = document.getElementById("bdg-chat");
  const chatTotal = _chatUnread + _aiUnread;
  if (bt) { bt.textContent = String(_taskPending); bt.style.display = _taskPending > 0 ? "flex" : "none"; }
  if (bc) { bc.textContent = String(chatTotal); bc.style.display = chatTotal > 0 ? "flex" : "none"; }
  updatePill();
}

// UI 骨架 v2 Task 11：顶栏 pill 三态简化（默认隐藏 / 主动态：有待确认 / 工作态：AI 处理中）
function updatePill() {
  const pill = document.getElementById("presencePill");
  if (!pill) return;
  if (_pillBusy) { pill.textContent = "AI 处理中…"; pill.style.display = ""; }
  else if (_taskPending > 0) { pill.textContent = `有 ${_taskPending} 件事等你确认`; pill.style.display = ""; }
  else pill.style.display = "none";
}

function setBackendStatus(ok: boolean, text: string) {
  document.getElementById("statusDot").className = "dot" + (ok ? " ok" : "");
  document.getElementById("statusText").textContent = text;
}

async function startBackend() {
  const inv = getTauriInvoke();
  if (!inv) return showToast("当前不是桌面应用环境", false);
  setBackendStatus(false, "正在启动后端...");
  document.getElementById("startBtn").style.display = "none";
  try {
    const status = await inv("start_backend", {}) as { running: boolean; message: string };
    setBackendStatus(status.running, status.message);
  } catch (e) {
    setBackendStatus(false, "启动失败");
    logDebug({ action: "start_backend", error: (e as Error).message || String(e) });
    document.getElementById("startBtn").style.display = "inline-block";
  }
}

async function runDiagnose() {
  const inv = getTauriInvoke();
  if (!inv) return;
  try {
    const info = await inv("diagnose", {}) as Record<string, unknown>;
    logDebug({ action: "diagnose", ...info });
  } catch (e) {
    logDebug({ action: "diagnose", error: (e as Error).message || String(e) });
  }
}

async function checkBackend() {
  try {
    await api("/api/tasks");
    setBackendStatus(true, "后端已连接");
  } catch (e) {
    setBackendStatus(false, "后端未启动");
    if (getTauriInvoke()) document.getElementById("startBtn").style.display = "inline-block";
  }
}

// ============ 登录 ============
function swapUser() {
  const sel = document.getElementById("quickUser") as HTMLSelectElement;
  const input = document.getElementById("loginUser") as HTMLInputElement;
  const v = sel.value;
  if (v === "__custom__") {
    sel.selectedIndex = 0; // 回到默认选项
    input.focus();
    input.select();
    return;
  }
  input.value = v;
}

async function doLogin() {
  const user = (document.getElementById("loginUser") as HTMLInputElement).value.trim();
  if (!user) return showToast("请输入用户名", false);
  const password = (document.getElementById("loginPwd") as HTMLInputElement | null)?.value || "";
  try {
    // P3 自建认证：username/password → session token（res.user_id 复用 OpenIM userID）
    const res = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: user, password }) }) as { ok?: boolean; user_id?: string; token?: string; error?: string };
    if (res.ok && res.user_id && res.token) {
      currentUser = res.user_id;
      currentToken = res.token;
      apiSetSession(res.user_id, res.token);
      localStorage.setItem("imai_user", res.user_id);
      localStorage.setItem("imai_token", res.token);
      enterMainApp();
      initSDK(res.user_id, res.token);
    } else {
      showToast("登录失败：" + (res.error || ""), false);
    }
  } catch (e) {
    showToast("登录异常：" + (e as Error).message, false);
  }
}

function logout() {
  localStorage.removeItem("imai_user");
  localStorage.removeItem("imai_token");
  currentUser = null;
  currentToken = null;
  apiSetSession(null, null);
  currentConversation = null;
  document.getElementById("mainApp").classList.add("hidden");
  document.getElementById("loginPage").classList.remove("hidden");
}

// ============ 契约类型（与后端 backend-ts 响应结构镜像；逐步收紧） ============
export interface TaskRow {
  id: number; grp_id?: number | null; content: string; creator: string | null;
  assignee: string | null; deadline: string | null; deadline_at: string | null;
  status: string; confidence: string | null; source_msg: string | null;
  pending_meta: string | null; created_at: string; updated_at: string | null;
  proofs?: Array<{ term: string; meaning: string | null }>;
}
export interface MessageRow {
  id: number; conv_id: string; sender_id: string; sender_name: string; content: string;
  content_type: number; is_self: number; msg_seq: number | null; client_msg_id: string | null; ts: string;
}
export interface AiDmRow { id: number; sender_id: string; direction: "in" | "out"; content: string; task_id: number | null; read_flag: number; ts: string; }
export interface AiCardResult {
  action?: string;
  intent?: Record<string, unknown>;
  task?: { content?: string; assignee?: string; deadline?: string; candidates?: Array<{ label: string }> } | null;
  assign?: { ambiguous_labels?: Array<{ label: string }> } | null;
}
export interface ApprovalRow { id: number; actor: string; action: string; detail: string | Record<string, unknown> | null; status: string; created_at: string; decided_at: string | null; decided_by: string | null; }
export interface ConversationItem {
  conversationID: string; conversationType: number; userID?: string; groupID?: string;
  showName?: string | null; latestMsg?: string | null; unreadCount?: number;
}
declare global {
}

// ============ OpenIM SDK 实时消息 ============
let sdk: unknown = null;
let connected = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function setSDKStatus(text: string, ok: boolean) {
  const el = document.getElementById("sdkStatus");
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? "#1a9e6c" : "#d64550";
}

async function initSDK(userID: string, token: string) {
  // 网关收敛后（网关收敛Spec §3-1）：不再有网关进程，实时性由 SSE 提供（initSSE），
  // 会话列表走后端 REST（loadConversations）。此函数仅保留入口语义。
  setSDKStatus("IM 连接中...", false);
  loadConversations();
  startSelfHeal();
}

// SSE 断线/丢帧自愈：定期刷新会话列表（原 15s 自愈逻辑保留，数据源换后端 REST）
function startSelfHeal() {
  if (pollTimer) clearInterval(pollTimer);
  let tick = 0;
  pollTimer = setInterval(async () => {
    if (++tick % 10 === 0) { try { loadConversations(); } catch (_) {} }
  }, 1500);
}

// 群名缓存：REST 会话列表不带 showName，异步解析真实群名后重渲染
const _groupNameCache = new Map();

// P3：群名随 /api/conversations 直接返回，旧 resolveGroupNames 已删

function renderConversations(list: Array<{ conv_id: string; group_id?: string | number | null; name?: string | null; last_message?: string | null }> | null | undefined, unreadMap: Record<string, number>) {
  const box = document.getElementById("sessionList");
  // P3 新契约：list = [{conv_id, group_id, name, last_message, last_sender, last_ts, last_msg_id}]
  let html = `<div class="session" id="aiSession" data-action="selectAISession">
      <div class="avatar ai">AI</div>
      <div class="session-info">
        <div class="session-title">AI 助手</div>
        <div class="session-preview" id="aiPreview">任务确认与提醒</div>
      </div>
      <div class="session-meta"><span class="badge" id="aiUnread" style="display:none">0</span></div>
    </div>`;
  html += (list || []).map(c => {
    const name = c.name || `群 ${c.group_id}`;
    const unread = (unreadMap || {})[c.conv_id] || 0;
    return `<div class="session" data-action="selectConversation" data-conv-id="${escAttr(c.conv_id)}" data-target-id="${escAttr(c.group_id)}" data-name="${escAttr(name)}" data-type="3">
      <div class="avatar">${name.slice(0,1)}</div>
      <div class="session-info">
        <div class="session-title">${name}</div>
        <div class="session-preview">${c.last_message || "暂无消息"}</div>
      </div>
      <div class="session-meta">${unread ? `<span class="badge">${unread}</span>` : ""}</div>
    </div>`;
  }).join("");
  box.innerHTML = html;
}

const _seenMsgIDs = new Set(); // 网关重启/页面重载会重放缓冲消息，按 clientMsgID 去重

function renderGWMessage(m: { clientMsgID?: string; sendID?: string; senderNickname?: string; content?: string; conversationID?: string; sendTime?: number | null }) {
  const box = document.getElementById("messages");
  if (!box) return;
  const msgKey = m.clientMsgID || "";
  if (msgKey) {
    if (_seenMsgIDs.has(msgKey)) return; // 重放缓冲重投递：跳过
    _seenMsgIDs.add(msgKey);
  } else {
    // 旧网关缓冲条目可能无 clientMsgID：按 sendID|内容|时间兕底去重，
    // 防止重放/多路投递同一条消息在聊天区重复渲染（2026-08-31 实证）
    const fk = `${m.sendID || ""}|${m.content || ""}|${m.sendTime || 0}`;
    if (_seenMsgIDs.has(fk)) return;
    _seenMsgIDs.add(fk);
  }
  // 会话过滤：带会话 ID 的消息只在对应会话里渲染，防跨会话串场（如群消息串进 AI 助手）
  if (m.conversationID && currentConversation && currentConversation.id !== m.conversationID) return;
  if (!m.conversationID && currentConversation && currentConversation.type === 3) return;
  const self = m.sendID === currentUser;
  const sender = m.senderNickname || m.sendID || "未知";
  const d = document.createElement("div");
  d.className = "msg" + (self ? " self" : "");
  d.innerHTML = `<div class="avatar">${(self ? "我" : sender.slice(0,1))}</div>
    <div><div class="msg-content">${(m.content||"").replace(/\n/g,"<br>")}</div>
    <div class="msg-meta"${self ? ' style="text-align:right;"' : ""}>${self ? "你" : sender} ${fmtTime(m.sendTime || Date.now())}</div></div>`;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

// 网关收敛后无 SDK 版会话渲染（原 renderConversationsFromSDK 已删，网关收敛Spec §3-1）

function handleSDKMessage(m: Parameters<typeof renderGWMessage>[0]) {
  renderGWMessage(m);
}

function enterMainApp() {
  document.getElementById("loginPage").classList.add("hidden");
  document.getElementById("mainApp").classList.remove("hidden");
  applyTheme();
  syncSettingsUI();
  showV2Onboarding();
  go(localStorage.getItem("imai_landing") || "chat");
  loadConversations();
  loadTasks();
  updateAIUnread();
  updatePill();
}

// UI 骨架 v2 Task 11：设置页 radio 选中态回显（落地页 / 主题）
function syncSettingsUI() {
  const landing = localStorage.getItem("imai_landing") || "chat";
  document.querySelectorAll<HTMLInputElement>("input[name='setLanding']").forEach(r => { r.checked = r.value === landing; });
  const theme = localStorage.getItem("imai_theme") || "light";
  document.querySelectorAll<HTMLInputElement>("input[name='setThemeMode']").forEach(r => { r.checked = r.value === theme; });
}

// UI 骨架 v2 Task 11：一次性引导条（localStorage.imai_v2_seen，「知道了」关闭后不再出现）
function showV2Onboarding() {
  try { if (localStorage.getItem("imai_v2_seen")) return; } catch (_) { return; }
  const right = document.querySelector("#mainApp .right");
  if (!right || document.getElementById("v2Tip")) return;
  const bar = document.createElement("div");
  bar.id = "v2Tip";
  bar.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--grad,#4f6ef7);color:#fff;font-size:12px;border-radius:0 0 10px 10px;";
  bar.innerHTML = `<span>新版上线：左侧导航切换视图；任务工作台汇总之所有待办；默认落地页可在设置修改</span>
    <button data-action="dismissV2" style="margin-left:auto;background:rgba(255,255,255,.22);border:none;color:#fff;padding:3px 12px;border-radius:8px;cursor:pointer;font-size:12px;flex-shrink:0;">知道了</button>`;
  right.insertBefore(bar, right.firstChild);
}

// ============ 会话 ============
async function loadConversations() {
  // P3 自建聊天层：会话列表来自 user_group + message 聚合（不再依赖 OpenIM REST）
  try {
    const res = await api("/api/conversations") as ApiResult & { conversations?: Array<{ conv_id: string; group_id?: string | number | null; name?: string | null; last_message?: string | null }> };
    if (!res.ok) { showToast("获取会话失败：" + (res.error || ""), false); return; }
    const unreadMap: Record<string, number> = {};
    try {
      const u = await api("/api/messages/unread") as { unread?: Array<{ conv_id: string; unread: number }> };
      let total = 0;
      (u.unread || []).forEach(x => { unreadMap[x.conv_id] = x.unread; total += x.unread; });
      // 聊天角标数据源：unread 全量覆盖（Task 10）；AI 助手未读由 updateAIUnread 并入
      updateBadges(_taskPending, total);
    } catch (_) {}
    renderConversations(res.conversations || [], unreadMap);
  } catch (e) {
    showToast("获取会话异常：" + (e as Error).message, false);
  }
}

let inAISession = false;

async function selectAISession() {
  inAISession = true;
  currentConversation = { id: "ai_dm", targetId: "imai_assistant", name: "AI 助手", type: "ai" };
  document.getElementById("chatTitle").textContent = "AI 助手";
  document.getElementById("chatSub").textContent = "任务确认与智能提醒";
  document.getElementById("messages").innerHTML = "";
  document.querySelectorAll(".session").forEach(el => el.classList.remove("active"));
  document.getElementById("aiSession").classList.add("active");
  await loadAIMessages();
}

async function loadAIMessages() {
  try {
    const res = await api("/api/ai_dm", { method: "GET", headers: { "Content-Type": "application/json" }, body: null }) as { ok?: boolean; messages?: AiDmRow[] };
    if (!res.ok && !res.messages) return; // 有 messages 即使缺 ok 也渲染（双保险）
    const box = document.getElementById("messages");
    box.innerHTML = "";
    (res.messages || []).forEach(m => {
      const self = m.direction === "in";
      const d = document.createElement("div");
      d.className = "msg" + (self ? " self" : "");
      d.innerHTML = `<div class="avatar ${self ? "" : "ai"}">${self ? "我" : "AI"}</div>
        <div><div class="msg-content">${(m.content || "").replace(/\n/g,"<br>")}</div>
        <div class="msg-meta"${self ? ' style="text-align:right;"' : ""}>${fmtTime(m.ts)}</div></div>`;
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
    // 已读
    await api("/api/ai_dm/read", { method: "POST", body: JSON.stringify({}) });
    updateAIUnread();
  } catch (e) {}
}

async function updateAIUnread() {
  try {
    const res = await api("/api/ai_dm") as { unread?: number };
    const el = document.getElementById("aiUnread");
    const cnt = res.unread || 0;
    _aiUnread = cnt;
    el.style.display = cnt ? "inline-block" : "none";
    el.textContent = String(cnt);
    // AI 助手未读并入聊天导航角标（Task 10）
    updateBadges(_taskPending, _chatUnread);
  } catch (e) {}
}

function selectConversation(convId: string, targetId: string, name: string, convType: number | string, el?: HTMLElement | null) {
  currentConversation = { id: convId, targetId, name, type: convType };
  document.getElementById("chatTitle").textContent = name;
  document.getElementById("chatSub").textContent = convType === 3 ? "群聊 · AI 旁听中" : "单聊";
  document.getElementById("messages").innerHTML = "";
  document.querySelectorAll(".session").forEach(s => s.classList.remove("active"));
  const active = el || (event?.currentTarget as HTMLElement | null);
  active?.classList.add("active");
  loadMessageHistory(convId);
}

async function loadMessageHistory(convId: string) {
  try {
    const res = await api(`/api/messages?conv_id=${encodeURIComponent(convId)}`) as { messages?: MessageRow[] };
    if (!res.messages || !res.messages.length) return;
    const box = document.getElementById("messages");
    box.innerHTML = "";
    // 历史整体重建是唯一渲染源：清空去重集合后按 DB 行重建，
    // 已渲染过的本地回显/轮询气泡会被 innerHTML 清掉，DB 行成为唯一权威（2026-09-01）
    _seenMsgIDs.clear();
    (res.messages || []).forEach(m => {
      if (m.client_msg_id) _seenMsgIDs.add(m.client_msg_id);
      // self 判断：is_self 兼容旧数据 + sender_id 比对（网关收敛Spec §3-6，修 own-history 显示）
      const self = m.is_self == 1 || m.sender_id === currentUser;
      const d = document.createElement("div");
      d.className = "msg" + (self ? " self" : "");
      d.innerHTML = `<div class="avatar">${(self ? "我" : (m.sender_name || "?")).slice(0,1)}</div>
        <div><div class="msg-content">${(m.content || "").replace(/\n/g,"<br>")}</div>
        <div class="msg-meta"${self ? ' style="text-align:right;"' : ""}>${self ? "你" : (m.sender_name || "")} ${fmtTime(m.ts)}</div></div>`;
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
    // 已读水位上报（最后一条 DB 行 id）
    const lastRow = (res.messages || [])[res.messages.length - 1];
    if (lastRow && lastRow.id) {
      api("/api/messages/read", { method: "POST", body: JSON.stringify({ conv_id: convId, last_msg_id: lastRow.id }) }).catch(() => {});
    }
  } catch (e) {}
}

// ============ 消息 ============
function toggleSim() {
  const box = document.getElementById("simBox");
  box.style.display = box.style.display === "none" ? "flex" : "none";
}

async function sendSim() {
  const sender = (document.getElementById("simSender") as HTMLInputElement).value.trim() || "同事";
  const text = (document.getElementById("simText") as HTMLTextAreaElement).value.trim();
  if (!text) return showToast("请输入消息内容", false);
  const convId = "sg_simulated";
  try {
    const res = await api("/api/simulate_message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sender, text, conv_id: convId }) }) as { ok?: boolean; error?: string; ai?: AiCardResult };
    if (res.ok) {
      // 显示到聊天区（别人发的，左侧）
      const box = document.getElementById("messages");
      const d = document.createElement("div");
      d.className = "msg";
      d.innerHTML = `<div class="avatar">${sender.slice(0,1)}</div>
        <div><div class="msg-content">${text.replace(/\n/g,"<br>")}</div>
        <div class="msg-meta">${sender} 刚刚</div></div>`;
      box.appendChild(d);
      box.scrollTop = box.scrollHeight;
      // AI 卡片
      if (res.ai) renderAICard(res.ai);
      // 刷新看板
      loadTasks();
      (document.getElementById("simText") as HTMLTextAreaElement).value = "";
    } else {
      showToast("模拟失败：" + (res.error || ""), false);
    }
  } catch (e) {
    showToast("模拟异常：" + (e as Error).message, false);
  }
}

async function sendMsg() {
  const input = document.getElementById("msg") as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text) return;
  if (!currentConversation) return showToast("请先选择一个会话", false);

  // 本地先渲染
  const msgs = document.getElementById("messages");
  const selfMsg = document.createElement("div");
  selfMsg.className = "msg self";
  selfMsg.innerHTML = `<div class="msg-content">${text.replace(/\n/g,"<br>")}</div><div class="msg-meta" style="text-align:right;">你 刚刚</div>`;
  msgs.appendChild(selfMsg);
  msgs.scrollTop = msgs.scrollHeight;
  input.value = "";

  // 去重键提前生成并登记：本地回显占位后，网关轮询缓冲（同 clientMsgID）与
  // 历史加载（同 client_msg_id）都跳过，修复「发一条弹两条」（2026-09-01）
  var cmid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(36).slice(2));
  _seenMsgIDs.add(cmid);

  // 工作态 pill：发送后 await 响应前显示「AI 处理中…」，响应/失败后恢复（Task 11）
  _pillBusy = true; updatePill();

  // AI 助手会话：回复数字确认
  if (currentConversation.type === "ai") {
    try {
      const res = await api("/api/tasks/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sender_id: currentUser, choice: text }) }) as { ok?: boolean; error?: string; reason?: string };
      if (!res.ok) {
        showToast("确认失败：" + (res.error || res.reason || "无待确认任务"), false);
      } else {
        await loadAIMessages();
        loadTasks();
      }
    } catch (e) {
      showToast("确认异常：" + (e as Error).message, false);
    }
    _pillBusy = false; updatePill();
    return;
  }

  // 群聊/单聊：P3 自建发送端点（内联 AI 闸门；落库幂等）；单聊暂不支持（Spec §4.4 移动端/单聊按需）
  try {
    if (currentConversation.type !== 3) {
      showToast("单聊发送将在切流后支持，请使用群聊", false);
      _pillBusy = false; updatePill();
      return;
    }
    const payload = { conv_id: "sg_" + currentConversation.targetId, text, client_msg_id: cmid };
    // cmid 已在本地回显前生成并登记；SSE 回声携带同 cmid/db_id，_seenMsgIDs 拦截
    const res = await api("/api/messages/send", { method: "POST", body: JSON.stringify(payload) }) as { ok?: boolean; error?: string; dedup?: boolean; id?: number };
    if (!res.ok) {
      if (res.dedup) { /* 幂等命中，本地已有回显 */ } else {
        showToast("发送失败：" + (res.error || ""), false);
      }
    } else {
      // SSE 回声将携带同 client_msg_id 与 db_id，_seenMsgIDs 已含 cmid；服务端 db_id 亦可用于去重
      if (res.id) _seenMsgIDs.add("db:" + res.id);
    }
    // 发送后刷新看板与 AI 未读（确认卡经 ai.card SSE / AI 助手会话到达）
    setTimeout(loadTasks, 1500);
    updateAIUnread();
  } catch (e) {
    showToast("发送异常：" + (e as Error).message, false);
  }
  _pillBusy = false; updatePill();
}

// ============ 看板 ============
let editingTaskId: number | null = null; // 迭代2 B1：正在内联编辑的任务 id
let _rejectingTaskId: number | null = null; // 驳回原因选择：正在选原因的任务 id
const REJECT_REASONS = ["负责人错了", "不需要建任务", "时间不对", "内容不对", "其他"] as const;

function parseDeadlineAt(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function fmtDeadlineDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderTaskCard(t: TaskRow) {
  const confCls: Record<string, string> = { high: "tag-high", medium: "tag-mid", low: "tag-low" };
  const isPending = t.status === "pending_confirmation";
  const isConfirmed = t.status === "confirmed";
  const isDone = t.status === "done";   // G1：完成终态
  const dlDate = parseDeadlineAt(t.deadline_at);
  // 已到截止时间仍未终结（确认中/已确认未取消/未完成）→ 逾期标红；done 不再标红
  const isOverdue = dlDate && dlDate.getTime() < Date.now() && t.status !== "cancelled" && !isDone;
  const proofs = (t.proofs || []).map(p => `${p.term}=${p.meaning || ""}`).slice(0, 2);
  let editHtml = "";
  if (isConfirmed && editingTaskId === t.id) {
    const dl = String(t.deadline_at || "").slice(0, 16).replace(" ", "T");
    editHtml = `<div class="ai-card-btns" style="margin-top:10px;flex-wrap:wrap;gap:6px;">
      <input id="editAssignee" value="${escAttr(t.assignee || "")}" placeholder="负责人"
        style="flex:1;min-width:90px;padding:4px 8px;border:1px solid #d0d3d8;border-radius:6px;font-size:12px;">
      <input id="editDeadline" type="datetime-local" value="${escAttr(dl)}"
        style="padding:4px 8px;border:1px solid #d0d3d8;border-radius:6px;font-size:12px;">
      <button class="primary" data-action="saveTaskEdit" data-task-id="${t.id}">保存</button>
      <button data-action="abortEdit">放弃</button>
    </div>`;
  }
  const confirmedBtns = (isConfirmed && editingTaskId !== t.id) ? `<div class="ai-card-btns" style="margin-top:10px;">
    <button class="a-yes" data-action="completeTask" data-task-id="${t.id}">完成</button>
    <button data-action="editTask" data-task-id="${t.id}">编辑</button>
    <button class="danger" data-action="cancelTask" data-task-id="${t.id}">取消任务</button>
  </div>` : "";
  const pendingBtns = _rejectingTaskId === t.id
    ? `<div class="ai-card-btns" style="margin-top:10px;flex-wrap:wrap;gap:6px;">
        <span style="font-size:11px;color:#8f959e;align-self:center;">驳回原因：</span>
        ${REJECT_REASONS.map((r) => `<button class="danger" data-action="rejectTaskReason" data-task-id="${t.id}" data-reason="${escAttr(r)}">${esc(r)}</button>`).join("")}
        <button data-action="abortReject">取消</button>
      </div>`
    : `<div class="ai-card-btns" style="margin-top:10px;">
        <button class="primary" data-action="confirmTask" data-task-id="${t.id}">确认</button>
        <button class="danger" data-action="rejectTask" data-task-id="${t.id}">驳回</button>
      </div>`;
  const doneBadge = isDone ? `<span style="color:#1a9e6c;font-weight:600;">✅ 已完成</span> · ` : "";
  return `
    <div class="task-card${isOverdue ? " overdue" : ""}">
      <div class="task-card-title">${doneBadge}${fmt(t.content)}</div>
      <div class="task-card-meta">
        <span>#${t.id}</span>
        <span>${fmt(t.assignee)}</span>
        <span${isOverdue ? ' style="color:#d64550;font-weight:600;"' : ""}>${fmt(t.deadline)}${dlDate ? ` · ${fmtDeadlineDate(dlDate)}` : ""}</span>
        ${isOverdue ? `<span class="tag tag-overdue">已逾期</span>` : ""}
        ${t.confidence ? `<span class="tag ${confCls[t.confidence]||'tag-low'}">${t.confidence}</span>` : ""}
      </div>
      ${proofs.length ? `<div class="task-proof">依据：${esc(proofs.join("；"))}</div>` : ""}
      ${isPending ? pendingBtns : ""}
      ${confirmedBtns}
      ${editHtml}
    </div>
  `;
}

async function confirmTask(id: number) {
  await api(`/api/tasks/${id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  loadTasks();
}

async function rejectTask(id: number, reason: string) {
  await api(`/api/tasks/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
  _rejectingTaskId = null;
  loadTasks();
}

async function saveTaskEdit(id: number) {
  const assignee = ((document.getElementById("editAssignee") as HTMLInputElement).value || "").trim();
  const dl = (document.getElementById("editDeadline") as HTMLInputElement).value || ""; // "YYYY-MM-DDTHH:MM"
  const body: Record<string, string> = {};
  if (assignee) body.assignee = assignee;
  if (dl) body.deadline = dl.replace("T", " ");
  try {
    await api(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    editingTaskId = null;
    loadTasks();
    showToast("任务已更新" + (body.deadline ? "，提醒已按新时间重算" : ""), true);
  } catch (e) {
    showToast("更新失败：" + (e as Error).message, false);
  }
}

async function cancelTask(id: number, btn: HTMLElement) {
  // 两步确认：第一次点变「确认取消?」，3 秒内再点才生效（不用阻塞式弹窗）
  if (btn.dataset.armed !== "1") {
    btn.dataset.armed = "1";
    btn.textContent = "确认取消?";
    setTimeout(() => { btn.dataset.armed = ""; btn.textContent = "取消任务"; }, 3000);
    return;
  }
  try {
    await api(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
    loadTasks();
    showToast("任务已取消", true);
  } catch (e) {
    showToast("取消失败：" + (e as Error).message, false);
  }
}

// 横排"需要你处理"确认卡（UI 骨架 v2 Task 8）：仅渲染 pending_confirmation 任务，
// 样式复用 .ai-card（.strip .ai-card 由 styles.css 适配横排）；驳回展开/行内编辑与看板卡同用
// _rejectingTaskId / editingTaskId 状态驱动（loadTasks 全量重渲染后自然展开/收起）
function renderStripCard(t: TaskRow) {
  const dlDate = parseDeadlineAt(t.deadline_at);
  const isOverdue = dlDate && dlDate.getTime() < Date.now();
  let btns: string;
  if (editingTaskId === t.id) {
    const dl = String(t.deadline_at || "").slice(0, 16).replace(" ", "T");
    btns = `<div class="ai-card-btns" style="margin-top:10px;flex-wrap:wrap;gap:6px;">
      <input id="editAssignee" value="${escAttr(t.assignee || "")}" placeholder="负责人"
        style="flex:1;min-width:90px;padding:4px 8px;border:1px solid #d0d3d8;border-radius:6px;font-size:12px;">
      <input id="editDeadline" type="datetime-local" value="${escAttr(dl)}"
        style="padding:4px 8px;border:1px solid #d0d3d8;border-radius:6px;font-size:12px;">
      <button class="primary" data-action="saveTaskEdit" data-task-id="${t.id}">保存</button>
      <button data-action="abortEdit">放弃</button>
    </div>`;
  } else if (_rejectingTaskId === t.id) {
    btns = `<div class="ai-card-btns" style="margin-top:10px;flex-wrap:wrap;gap:6px;">
      <span style="font-size:11px;color:#8f959e;align-self:center;">驳回原因：</span>
      ${REJECT_REASONS.map((r) => `<button class="danger" data-action="rejectTaskReason" data-task-id="${t.id}" data-reason="${escAttr(r)}">${esc(r)}</button>`).join("")}
      <button data-action="abortReject">取消</button>
    </div>`;
  } else {
    btns = `<div class="ai-card-btns" style="margin-top:10px;">
      <button class="primary" data-action="confirmTask" data-task-id="${t.id}">确认</button>
      <button class="danger" data-action="rejectTask" data-task-id="${t.id}">驳回▾</button>
      <button data-action="editTask" data-task-id="${t.id}">改负责人</button>
    </div>`;
  }
  return `<div class="ai-card">
    <div class="ai-card-header"><div class="aav">AI</div><div class="ai-card-title">${fmt(t.content)}</div><span class="kind">需要你处理</span></div>
    <div class="ai-card-body" style="font-size:12px;color:#8f959e;">
      #${t.id} · 负责人：${fmt(t.assignee)} · 截止：${fmt(t.deadline)}${dlDate ? ` · ${fmtDeadlineDate(dlDate)}` : ""}${isOverdue ? ` · <span style="color:#d64550;font-weight:600;">已逾期</span>` : ""}${t.source_msg ? `<br>来源：${esc(String(t.source_msg).slice(0, 60))}` : ""}
    </div>
    ${btns}
  </div>`;
}

async function loadTasks() {
  try {
    const data = await api("/api/tasks") as { tasks?: TaskRow[] };
    const tasks = data.tasks || [];
    const pendingAssignee = tasks.filter(t => t.status === "pending_assignee");
    const pending = tasks.filter(t => t.status === "pending_confirmation");
    const confirmed = tasks.filter(t => t.status === "confirmed");
    const done = tasks.filter(t => t.status === "done");
    // 老化排序：越临近/越已过期的待决任务排越前，避免旧任务沉底被遗忘
    const byDeadline = (a: TaskRow, b: TaskRow) => (parseDeadlineAt(a.deadline_at)?.getTime() ?? Infinity) - (parseDeadlineAt(b.deadline_at)?.getTime() ?? Infinity);
    pendingAssignee.sort(byDeadline); pending.sort(byDeadline);
    // 进行中：逾期（deadline_at < now）置顶，其余按截止时间升序（UI 骨架 v2 Task 8）
    const now = Date.now();
    confirmed.sort((a, b) => {
      const oa = (parseDeadlineAt(a.deadline_at)?.getTime() ?? Infinity) < now ? 0 : 1;
      const ob = (parseDeadlineAt(b.deadline_at)?.getTime() ?? Infinity) < now ? 0 : 1;
      return oa - ob || byDeadline(a, b);
    });
    // 已完成：倒序，最近完成在前（updated_at 为完成时间）
    done.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    document.getElementById("countPendingAssignee").textContent = String(pendingAssignee.length);
    document.getElementById("countPending").textContent = String(pending.length);
    document.getElementById("countConfirmed").textContent = String(confirmed.length);
    document.getElementById("countDone").textContent = String(done.length);
    document.getElementById("listPendingAssignee").innerHTML = pendingAssignee.map(renderTaskCard).join("") || "<div style='color:#8f959e;font-size:12px;'>暂无待指派任务</div>";
    document.getElementById("listPending").innerHTML = pending.map(renderTaskCard).join("") || "<div style='color:#8f959e;font-size:12px;'>暂无待确认任务</div>";
    document.getElementById("listConfirmed").innerHTML = confirmed.map(renderTaskCard).join("") || "<div style='color:#8f959e;font-size:12px;'>暂无已确认任务</div>";
    document.getElementById("listDone").innerHTML = done.map(renderTaskCard).join("") || "<div style='color:#8f959e;font-size:12px;'>暂无已完成任务</div>";
    // 横排"需要你处理"：全部 pending_confirmation 平铺（不做用户过滤）；无则隐藏
    const strip = document.getElementById("stripPending");
    strip.innerHTML = pending.map(renderStripCard).join("");
    strip.style.display = pending.length ? "" : "none";
    // 任务角标数据源：待确认 + 待指派（Task 10）；聊天未读用模块级缓存，避免覆盖
    updateBadges(pending.length + pendingAssignee.length, _chatUnread);
    setBackendStatus(true, "后端已连接");
  } catch (e) {
    setBackendStatus(false, "后端未连接");
  }
}

// ============ M3/M4 前端面板（UI 骨架 v2：面板映射到视图容器） ============
const _PANEL_VIEW: Record<string, string> = { board: "task", approval: "approval", rbac: "rbac", memory: "memory", summary: "summary", minutes: "summary" };
function showPanel(name: string) {
  go(_PANEL_VIEW[name] || "chat");
}

// ============ UI 骨架 v2：视图切换 / 主题（胶水层，不改业务逻辑） ============
const VIEW_TITLES: Record<string, string> = {
  chat: "聊天", task: "任务工作台", approval: "审批",
  memory: "AI 的记忆", summary: "汇总与纪要", rbac: "权限", settings: "设置",
};
function go(view: string) {
  const target = document.getElementById("view-" + view);
  if (!target) return;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("on"));
  target.classList.add("on");
  document.querySelectorAll(".nitem").forEach(n => {
    const el = n as HTMLElement;
    el.classList.toggle("on", el.dataset.view === view);
  });
  const t = document.getElementById("viewTitle");
  if (t) t.textContent = VIEW_TITLES[view] || view;
}

function applyTheme(mode?: string) {
  const m = mode || localStorage.getItem("imai_theme") || "light";
  document.documentElement.setAttribute("data-theme", m === "dark" ? "dark" : "light");
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  localStorage.setItem("imai_theme", cur);
  applyTheme(cur);
}

async function loadSummary() {
  loadSummaryArchives(); // 归档区独立于汇总生成结果，并行刷新
  const box = document.getElementById("summaryBox");
  try {
    const data = await api("/api/summary/daily") as { text?: string };
    // 先转义再换行，避免 <br> 被转义成字面文本（双重转义 bug）
    const text = esc(data.text || "").replace(/\n/g, "<br>");
    box.innerHTML = `<div class="summary-text">${text}</div>`;
  } catch (e) {
    box.innerHTML = `<div class='approval-empty'>生成失败：${esc((e as Error).message)}</div>`;
  }
}

// 汇总页：已取消 / 已驳回任务归档（折叠区，容器在 index.html #view-summary）
async function loadSummaryArchives() {
  const renderList = (el: HTMLElement | null, list: TaskRow[], errMsg: string) => {
    if (!el) return;
    el.innerHTML = errMsg
      ? `<div style="color:#8f959e;font-size:12px;">${errMsg}</div>`
      : (list.length
        ? list.map(t => `<div class="memory-term">#${t.id} ${esc(t.content)} · 负责人：${esc(t.assignee || "—")} · ${esc(String(t.updated_at || t.created_at || "").slice(0, 10))}</div>`).join("")
        : `<div style="color:#8f959e;font-size:12px;">暂无</div>`);
  };
  const [c, r] = await Promise.allSettled([
    api("/api/tasks?status=cancelled") as Promise<{ tasks?: TaskRow[] }>,
    api("/api/tasks?status=rejected") as Promise<{ tasks?: TaskRow[] }>,
  ]);
  renderList(document.getElementById("sumCancelled"), c.status === "fulfilled" ? (c.value.tasks || []) : [], c.status === "rejected" ? "加载失败" : "");
  renderList(document.getElementById("sumRejected"), r.status === "fulfilled" ? (r.value.tasks || []) : [], r.status === "rejected" ? "加载失败" : "");
}

let _approvalStatus = "pending";

async function loadApprovals(status?: string) {
  if (status) _approvalStatus = status;
  const st = _approvalStatus;
  const box = document.getElementById("approvalList");
  try {
    const data = await api(`/api/approvals?status=${encodeURIComponent(st)}`) as { approvals?: ApprovalRow[] };
    const list = data.approvals || [];
    if (!list.length) {
      const emptyText = { pending: "暂无待审批的高风险动作 ✅", approved: "暂无已批准记录", rejected: "暂无已拒绝记录" }[st] || "暂无记录";
      box.innerHTML = `<div class='approval-empty'>${emptyText}</div>`;
      return;
    }
    box.innerHTML = list.map(a => {
      let detail = "";
      try { detail = JSON.stringify(JSON.parse(String(a.detail)), null, 2); } catch(e) { detail = String(a.detail ?? ""); }
      const decided = a.status !== "pending" ? `<div style="font-size:11px;color:#8f959e;margin-bottom:6px;">${esc(a.decided_by || "")} · ${esc(a.decided_at || "")}</div>` : "";
      const btns = a.status === "pending" ? `
        <div class="a-btns">
          <button class="a-yes" data-action="approveApproval" data-approval-id="${a.id}">批准</button>
          <button class="a-no" data-action="rejectApproval" data-approval-id="${a.id}">拒绝</button>
        </div>` : "";
      return `<div class="approval-item">
        <div class="a-head"><span class="a-action">${esc(a.action)}</span><span style="font-size:11px;color:#8f959e;">#${a.id} · ${esc(a.status)}</span></div>
        ${decided}
        <div class="a-detail">${esc(detail)}</div>
        ${btns}
      </div>`;
    }).join("");
  } catch (e) {
    box.innerHTML = `<div class='approval-empty'>加载失败：${esc((e as Error).message)}</div>`;
  }
}

async function approveApproval(id: number) {
  try {
    const r = await api(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ approved: true }) }) as { ok?: boolean; error?: string };
    showToast(r.ok ? "已批准" : "批准失败：" + (r.error || ""), !!r.ok);
    loadApprovals(); loadTasks();
  } catch (e) { showToast("批准异常：" + (e as Error).message, false); }
}

async function rejectApproval(id: number) {
  try {
    const r = await api(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ approved: false }) }) as { ok?: boolean; error?: string };
    showToast(r.ok ? "已拒绝" : "拒绝失败：" + (r.error || ""), !!r.ok);
    loadApprovals();
  } catch (e) { showToast("拒绝异常：" + (e as Error).message, false); }
}

async function completeTask(id: number) {
  try {
    const r = await api(`/api/tasks/${id}/complete`, { method: "POST", body: JSON.stringify({ actor: currentUser }) }) as { ok?: boolean };
    showToast(r.ok ? "任务已完成 ✅" : "操作失败", !!r.ok);
    loadTasks();
  } catch (e) { showToast("完成异常：" + (e as Error).message, false); }
}

// ============ M3 权限可视化（M3权限前端可视化Spec）============
async function loadRbac() { await loadRoles(); await loadAudit(); }

async function loadRoles() {
  const box = document.getElementById("roleList");
  try {
    const data = await api("/api/roles") as { roles?: Array<{ oim_user_id: string; role: string; updated_at?: string | null }> };
    const list = data.roles || [];
    let html = `<div class="approval-item"><div class="a-head"><span class="a-action">imAdmin</span><span style="font-size:11px;color:#8f959e;">group_admin（固定）</span></div></div>`;
    if (!list.length) {
      html += "<div class='approval-empty'>role 表暂无记录（所有人默认 member）</div>";
    } else {
      html += list.map(r => `
        <div class="approval-item">
          <div class="a-head"><span class="a-action">${esc(r.oim_user_id)}</span>
            <span class="role-badge ${r.role === "group_admin" ? "role-admin" : ""}">${esc(r.role)}</span></div>
          <div style="font-size:11px;color:#8f959e;">更新于 ${esc(r.updated_at || "")}</div>
        </div>`).join("");
    }
    box.innerHTML = html;
  } catch (e) {
    box.innerHTML = `<div class='approval-empty'>加载失败：${esc((e as Error).message)}</div>`;
  }
}

async function setRole() {
  const uid = (document.getElementById("roleUserId") as HTMLInputElement).value.trim();
  const role = (document.getElementById("roleValue") as HTMLSelectElement).value;
  if (!uid) { showToast("请输入 OpenIM 用户ID", false); return; }
  try {
    const r = await api("/api/role/set", { method: "POST", body: JSON.stringify({ oim_user_id: uid, role }) }) as { ok?: boolean; error?: string; role?: string };
    showToast(r.ok ? `已设置 ${uid} = ${r.role}` : "设置失败：" + (r.error || ""), !!r.ok);
    if (r.ok) { (document.getElementById("roleUserId") as HTMLInputElement).value = ""; loadRoles(); }
  } catch (e) { showToast("设置异常：" + (e as Error).message, false); }
}

function _fmtAuditTime(ts: unknown) {
  // ISO（2026-09-02T08:48:18.154161+08:00）→ 2026-09-02 08:48
  return ts ? String(ts).slice(0, 16).replace("T", " ") : "";
}

function _fmtAuditDetail(d: unknown) {
  // 人性化 detail：优先取 text 字段（汇总/通知类），其余紧凑 key=value，避免原始 JSON 倾倒
  let obj: unknown = d;
  if (typeof obj === "string") { try { obj = JSON.parse(obj); } catch (e) { return String(obj).slice(0, 140); } }
  if (obj && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    if (rec.text) return String(rec.text).replace(/\n+/g, " ／ ");
    return Object.entries(rec)
      .map(([k, v]) => `${k}=${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`)
      .join(" · ").slice(0, 140);
  }
  return String(d).slice(0, 140);
}

async function loadAudit() {
  const box = document.getElementById("auditList");
  try {
    const data = await api("/api/audit?limit=30") as { audit?: Array<{ action: string; actor?: string | null; ts?: string | null; created_at?: string | null; detail?: unknown }> };
    const list = data.audit || [];
    if (!list.length) {
      box.innerHTML = "<div class='approval-empty'>暂无审计记录</div>";
      return;
    }
    box.innerHTML = list.map(a => `
      <div class="approval-item audit-item">
        <div class="a-head"><span class="a-action">${esc(a.action)}</span><span style="font-size:11px;color:#8f959e;">${esc(a.actor || "")} · ${esc(_fmtAuditTime(a.ts || a.created_at))}</span></div>
        <div class="a-detail" style="margin-bottom:0;">${esc(_fmtAuditDetail(a.detail))}</div>
      </div>`).join("");
  } catch (e) {
    box.innerHTML = `<div class='approval-empty'>加载失败：${esc((e as Error).message)}</div>`;
  }
}

async function loadMemory() {
  const box = document.getElementById("memoryHtml");
  try {
    // 并行：记忆数据 + 当前用户角色（决定是否渲染删除按钮；请求失败按 member 处理）
    const memP = api("/api/memory") as Promise<{ memory?: { terms?: Array<{ term: string; meaning: string | null; source?: string | null }>; grp_meta?: { intro?: string } | null } }>;
    const roleP = (async (): Promise<string> => {
      if (!currentUser) return "member";
      try {
        const r = await api(`/api/role/${encodeURIComponent(currentUser)}`) as { role?: string };
        return r.role === "group_admin" ? "group_admin" : "member";
      } catch (_) { return "member"; }
    })();
    const [data, role] = await Promise.all([memP, roleP]);
    const terms = data.memory?.terms || [];
    const gm = data.memory?.grp_meta;
    const isAdmin = role === "group_admin";
    let html = `<div class="memory-banner">🧠 团队记忆 · ${terms.length} 条术语${gm && gm.intro ? " · 已收录群简介" : ""}</div>`;
    // 拟人化：最近学到（来源含 reject/correct/纠正 的最近 3 条，没有就不显示；后端纠正类 source 为 corrected）
    const learned = terms.filter(t => /reject|correct|纠正/.test(t.source || "")).slice(-3);
    if (learned.length) {
      html += `<div class="memory-block"><div class="memory-block-title">最近学到</div>${learned.map(t =>
        `<div class="memory-term">学到：<b>${esc(t.term)}</b> = ${esc(t.meaning)}</div>`).join("")}</div>`;
    }
    // 迭代2 B3：手动新增术语入口
    html += `<div class="memory-block"><div class="memory-block-title">新增术语</div>
      <div class="ai-card-btns" style="flex-wrap:wrap;gap:6px;">
        <input id="newTerm" placeholder="术语/称呼" style="flex:1;min-width:90px;padding:4px 8px;border:1px solid #d0d3d8;border-radius:6px;font-size:12px;">
        <input id="newTermMeaning" placeholder="含义" style="flex:2;min-width:120px;padding:4px 8px;border:1px solid #d0d3d8;border-radius:6px;font-size:12px;">
        <button class="primary" data-action="addTermUI">添加</button>
      </div></div>`;
    if (gm && gm.intro) {
      html += `<div class="memory-block"><div class="memory-block-title">群简介</div><div class="memory-term">${esc(gm.intro)}</div></div>`;
    }
    html += `<div class="memory-block"><div class="memory-block-title">术语 / 人称记忆（${terms.length}）</div>`;
    if (terms.length) {
      html += terms.map(t => {
        if (editingTerm === t.term) {
          return `<div class="memory-term"><b>${esc(t.term)}</b> =
            <input id="editTermMeaning" value="${escAttr(t.meaning || "")}"
              style="padding:3px 6px;border:1px solid #d0d3d8;border-radius:6px;font-size:12px;width:60%;">
            <button class="primary" data-action="saveTermEdit" data-term="${escAttr(t.term)}">保存</button>
            <button data-action="abortTermEdit">放弃</button></div>`;
        }
        const delBtn = isAdmin ? `<button class="danger" data-action="deleteTerm" data-term="${escAttr(t.term)}" style="margin-left:2px;">🗑</button>` : "";
        return `<div class="memory-term"><b>${esc(t.term)}</b> = ${esc(t.meaning)} <span style="color:#8f959e;font-size:11px;">[${esc(t.source)}]</span>
          <button data-action="editTerm" data-term="${escAttr(t.term)}" style="margin-left:6px;">✎</button>${delBtn}</div>`;
      }).join("");
    } else {
      html += `<div style="color:#8f959e;font-size:12px;">暂无记忆，驳回/纠正会沉淀</div>`;
    }
    html += `</div>`;
    box.innerHTML = html;
    mineRefresh();
  } catch (e) {
    box.innerHTML = `<div class='approval-empty'>加载失败：${esc(e.message)}</div>`;
  }
}

// ============ 迭代3 B4：历史消息挖掘 ============

async function mineRefresh() {
  // 会话下拉：与纪要页同源缓存（P3 自建契约），空则拉一次
  if (!_minutesConvs.length) {
    try {
      const res = await api("/api/conversations") as ApiResult & { conversations?: Array<{ conv_id: string; group_id?: string | number | null; name?: string | null }> };
      if (res.ok) {
        _minutesConvs = (res.conversations || []).map(c => ({ id: c.conv_id, name: c.name || `群 ${c.group_id}` }));
      }
    } catch (_) {}
  }
  const sel = document.getElementById("mineConv") as HTMLSelectElement | null;
  if (sel && _minutesConvs.length) {
    const cur = sel.value;
    sel.innerHTML = _minutesConvs.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join("");
    if (cur && _minutesConvs.some(c => c.id === cur)) sel.value = cur;
  }
  loadMineCandidates();
}

function _mineSummary(c: { kind: string; payload?: Record<string, string | undefined> }) {
  const p = c.payload || {};
  if (c.kind === "term") return `术语 <b>${esc(p.term)}</b> = ${esc(p.meaning)}`;
  if (c.kind === "alias") return `称呼 <b>${esc(p.real_name)}</b> ← ${esc(p.alias)}`;
  if (c.kind === "task") return `任务 <b>${esc(p.content)}</b>${p.assignee_hint ? `（${esc(p.assignee_hint)}）` : ""}${p.deadline_hint ? ` [${esc(p.deadline_hint)}]` : ""}`;
  return esc(c.kind);
}

const _MINE_KIND_LABEL: Record<string, string> = { term: "术语", alias: "称呼", task: "任务" };

async function loadMineCandidates() {
  const box = document.getElementById("mineCands");
  if (!box) return;
  try {
    const data = await api("/api/mine/candidates") as { candidates?: Array<{ id: number | string; kind: string; evidence?: string | null; payload?: Record<string, string | undefined> }> };
    const list = data.candidates || [];
    if (!list.length) {
      box.innerHTML = `<div style="color:#8f959e;font-size:12px;padding:8px;">暂无待确认候选。选会话后点「跑挖掘」</div>`;
      return;
    }
    box.innerHTML = list.map(c => `
      <div class="memory-term" style="display:flex;align-items:center;gap:6px;">
        <span style="background:#eef1f6;border-radius:4px;padding:1px 5px;font-size:11px;color:#5a6482;">${_MINE_KIND_LABEL[c.kind] || esc(c.kind)}</span>
        <span style="flex:1;">${_mineSummary(c)}${c.evidence ? `<br><span style="color:#8f959e;font-size:11px;">原文：${esc(c.evidence)}</span>` : ""}</span>
        <button class="primary" data-action="decideMine" data-cid="${c.id}" data-do="accept">接受</button>
        <button class="danger" data-action="decideMine" data-cid="${c.id}" data-do="reject">拒绝</button>
      </div>`).join("");
  } catch (e) {
    box.innerHTML = `<div style="color:#8f959e;font-size:12px;padding:8px;">加载失败：${esc((e as Error).message)}</div>`;
  }
}

async function runMining() {
  const convId = (document.getElementById("mineConv") as HTMLSelectElement).value;
  const limit = Number((document.getElementById("mineLimit") as HTMLInputElement).value) || 500;
  if (!convId) { showToast("请先选择会话", false); return; }
  showToast("挖掘中…（LLM 分批处理，可能需要十几秒）", true);
  try {
    const r = await api("/api/mine/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conv_id: convId, limit }) }) as { by_kind?: Record<string, number>; skipped_batches?: number };
    const k = r.by_kind || {};
    showToast(`挖掘完成：术语 ${k.term || 0} · 称呼 ${k.alias || 0} · 任务 ${k.task || 0}${r.skipped_batches ? `（跳过 ${r.skipped_batches} 批）` : ""}`, true);
    loadMineCandidates();
  } catch (e) {
    showToast("挖掘失败：" + (e as Error).message, false);
  }
}

async function decideMine(cid: number, action: string, btn: HTMLElement) {
  // 两步确认：拒绝需二次点击，防误触
  if (action === "reject" && btn.dataset.armed !== "1") {
    btn.dataset.armed = "1"; btn.textContent = "确认拒绝";
    setTimeout(() => { btn.dataset.armed = ""; btn.textContent = "拒绝"; }, 3000);
    return;
  }
  try {
    const r = await api(`/api/mine/candidates/${cid}/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }) as { result?: { taskId?: number } };
    showToast(action === "accept" ? "已入库" : "已拒绝", true);
    loadMineCandidates();
    if (action === "accept" && r.result && r.result.taskId) {
      showToast(`任务 #${r.result.taskId} 已进看板待确认`, true);
    }
  } catch (e) {
    showToast("操作失败：" + (e as Error).message, false);
  }
}

// ============ 迭代2 B3：术语手动增删改 ============
let editingTerm: string | null = null; // 正在内联编辑释义的术语

async function addTermUI() {
  const term = ((document.getElementById("newTerm") as HTMLInputElement).value || "").trim();
  const meaning = ((document.getElementById("newTermMeaning") as HTMLInputElement).value || "").trim();
  if (!term || !meaning) { showToast("术语和含义都要填", false); return; }
  try {
    await api("/api/term/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term, meaning }) });
    loadMemory();
    showToast("术语已添加", true);
  } catch (e) {
    showToast("添加失败：" + (e as Error).message, false);
  }
}

async function saveTermEdit(term: string) {
  const meaning = ((document.getElementById("editTermMeaning") as HTMLInputElement).value || "").trim();
  if (!meaning) { showToast("含义不能为空", false); return; }
  try {
    await api(`/api/term/${encodeURIComponent(term)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meaning }) });
    editingTerm = null;
    loadMemory();
    showToast("术语已更新", true);
  } catch (e) {
    showToast("更新失败：" + (e as Error).message, false);
  }
}

async function deleteTerm(term: string, btn: HTMLElement) {
  // 两步确认：第一次点变「确认删除?」，3 秒内再点才生效
  if (btn.dataset.armed !== "1") {
    btn.dataset.armed = "1";
    btn.textContent = "确认删除?";
    setTimeout(() => { btn.dataset.armed = ""; btn.textContent = "🗑"; }, 3000);
    return;
  }
  try {
    await api(`/api/term/${encodeURIComponent(term)}`, { method: "DELETE" });
    loadMemory();
    showToast("术语已删除", true);
  } catch (e) {
    showToast("删除失败：" + (e as Error).message, false);
  }
}

// ============ 迭代2 B2：会议纪要 ============
let _minutesConvs: Array<{ id: string; name: string }> = []; // 缓存，供下拉与卡片显示会话名

async function loadMinutes() {
  // 会话下拉：与左侧会话列表同源（P3 自建契约）
  try {
    const res = await api("/api/conversations") as ApiResult & { conversations?: Array<{ conv_id: string; group_id?: string | number | null; name?: string | null }> };
    if (res.ok) {
      _minutesConvs = (res.conversations || []).map(c => ({ id: c.conv_id, name: c.name || `群 ${c.group_id}` }));
    }
  } catch (_) {}
  const sel = document.getElementById("minutesConv") as HTMLSelectElement | null;
  if (sel && _minutesConvs.length) {
    const cur = sel.value;
    sel.innerHTML = _minutesConvs.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join("");
    if (cur && _minutesConvs.some(c => c.id === cur)) sel.value = cur;
  }
  // 历史纪要列表
  const box = document.getElementById("minutesList");
  try {
    const data = await api("/api/minutes") as { minutes?: Array<{ id: number; title: string; conv_id: string; msg_count: number; created_at?: string | null; summary?: string | null; decisions?: string[]; action_items?: Array<{ content: string; assignee_hint?: string | null; deadline_hint?: string | null }> }> };
    const list = data.minutes || [];
    if (!list.length) {
      box.innerHTML = `<div style="color:#8f959e;font-size:12px;">还没有纪要，选会话后点「生成纪要」</div>`;
      return;
    }
    const convName = (id: string) => { const c = _minutesConvs.find(x => x.id === id); return c ? c.name : id; };
    box.innerHTML = list.map(m => `
      <div class="memory-block">
        <div class="memory-block-title">${esc(m.title)} <span style="color:#8f959e;font-size:11px;">${esc(convName(m.conv_id))} · ${m.msg_count} 条消息 · ${esc(String(m.created_at||"").slice(0,16))}</span></div>
        <div class="memory-term">${esc(m.summary || "")}</div>
        ${(m.decisions||[]).length ? `<div class="memory-term"><b>结论</b>：${m.decisions.map(d => esc(d)).join("；")}</div>` : ""}
        ${(m.action_items||[]).length ? `<div class="memory-term"><b>行动项</b></div>` + m.action_items.map((a, i) =>
          `<div class="memory-term" style="display:flex;align-items:center;gap:6px;">
            <span style="flex:1;">· ${esc(a.content)}${a.assignee_hint ? `（${esc(a.assignee_hint)}）` : ""}${a.deadline_hint ? ` [${esc(a.deadline_hint)}]` : ""}</span>
            <button data-action="minutesToTask" data-mid="${m.id}" data-index="${i}">转任务</button>
          </div>`).join("") : ""}
      </div>`).join("");
  } catch (e) {
    box.innerHTML = `<div class='approval-empty'>加载失败：${esc((e as Error).message)}</div>`;
  }
}

async function generateMinutes() {
  const convId = (document.getElementById("minutesConv") as HTMLSelectElement).value;
  const limit = Number((document.getElementById("minutesLimit") as HTMLInputElement).value) || 50;
  if (!convId) { showToast("请先选择会话", false); return; }
  showToast("正在生成纪要…（LLM 需要几秒）", true);
  try {
    await api("/api/minutes/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conv_id: convId, limit }) });
    loadMinutes();
    showToast("纪要已生成", true);
  } catch (e) {
    showToast("生成失败：" + (e as Error).message, false);
  }
}

async function minutesToTask(mid: number, index: number) {
  try {
    const r = await api(`/api/minutes/${mid}/task`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index }) }) as { taskId?: number };
    showToast(`已转入看板待确认（任务 #${r.taskId}）`, true);
  } catch (e) {
    showToast("转任务失败：" + (e as Error).message, false);
  }
}

function esc(s: unknown) {
  return String(s == null ? "" : s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
}

function renderAICard(r: AiCardResult) {
  const box = document.getElementById("messages");
  if (!box) return;
  const intent = r.intent || {};
  let body = "";
  if (r.action === "skip") {
    body = "未识别到任务安排，已静默跳过。";
  } else if (r.action === "confirm_assignee") {
    const labels = (r.task?.candidates) || (r.assign?.ambiguous_labels) || [];
    body = `<b>归属歧义</b>：检测到多个负责人，请到【AI 助手】会话回复数字确认。<br>`;
    body += labels.map((c, i) => `${i+1}. ${c.label}`).join("<br>");
  } else if (r.action === "task_created") {
    const t = r.task || {};
    body = `<b>已生成任务</b>：${fmt(t.content)}<br>负责人：${fmt(t.assignee)}<br>截止：${fmt(t.deadline)}`;
  }
  const card = document.createElement("div");
  card.className = "ai-card";
  card.innerHTML = `<div class="ai-card-header"><div class="ai-icon">AI</div><div class="ai-card-title">AI 助手</div></div><div class="ai-card-body">${body}</div>`;
  box.appendChild(card);
  box.scrollTop = box.scrollHeight;
}

// 实时事件（网关收敛后：SSE 是唯一实时通道，消息/任务/卡片都走这里）
let esAI: EventSource | null = null;
let _lastReconnectRefresh = 0;
function initSSE() {
  if (!window.EventSource || esAI) return;
  try {
    esAI = new EventSource(API_BASE + "/api/events/stream");
    esAI.onopen = () => {
      setSDKStatus("IM 已连接 ✅", true);
      // 断线重连/首连：全量刷新兔丢帧（离线消息靠 DB，历史是唯一渲染权威）
      const now = Date.now();
      if (now - _lastReconnectRefresh > 5000) {
        _lastReconnectRefresh = now;
        loadConversations();
        if (currentConversation && currentConversation.id && currentConversation.type !== "ai") {
          loadMessageHistory(currentConversation.id);
        }
        updateAIUnread();
      }
    };
    esAI.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as { type?: string; client_msg_id?: string; db_id?: number | string; send_id?: string; sender_nickname?: string; content?: string; conv_id?: string; send_time?: number | null; ts?: number | null };
        if (ev.type === "message") {
          // P3：SSE 回声携带 db_id + client_msg_id 双去重键（评审 D3）
          const dedupKeys = [ev.client_msg_id, ev.db_id ? "db:" + ev.db_id : ""].filter(Boolean);
          if (dedupKeys.length && dedupKeys.some(k => _seenMsgIDs.has(k))) {
            // 本地回声/历史已渲染，跳过
          } else {
            dedupKeys.forEach(k => _seenMsgIDs.add(k));
            renderGWMessage({
              sendID: ev.send_id,
              senderNickname: ev.sender_nickname,
              content: ev.content,
              clientMsgID: ev.client_msg_id || (ev.db_id ? "db:" + ev.db_id : ""),
              conversationID: ev.conv_id,
              sendTime: ev.send_time || ev.ts || Date.now(),
            });
            // 聊天角标即时 +1：非当前会话且非自己发的消息（当前会话由已读水位上报，下次轮询校正）
            if (ev.send_id !== currentUser && (!currentConversation || ev.conv_id !== currentConversation.id)) {
              _chatUnread++;
              updateBadges(_taskPending, _chatUnread);
            }
            // 正在看的会话 → 上报已读水位
            if (currentConversation && ev.conv_id === currentConversation.id && ev.db_id) {
              api("/api/messages/read", { method: "POST", body: JSON.stringify({ conv_id: ev.conv_id, last_msg_id: ev.db_id }) }).catch(() => {});
            }
          }
        }
        if (ev.type === "task_created" || ev.type === "ai.card") loadTasks();
        if (ev.type === "task_status") loadTasks(); // 确认/驳回/更新后的轻量收敛：全量刷新（5s 轮询兜底不变）
        if (ev.type === "task_completed") { loadTasks(); showToast("任务已完成 ✅", true); }
        if (ev.type === "task_created" || ev.type === "ai.card") updateAIUnread();
      } catch (_) {}
    };
    // EventSource 断线自动重连；无需手动重建
  } catch (_) { esAI = null; }
}

// 初始化
window.onload = () => {
  // 调试入口：URL ?debug=1 或 localStorage.imai_debug=1 时才显示「模拟群消息」，普通使用者不可见
  try {
    if (new URLSearchParams(location.search).has("debug")) localStorage.setItem("imai_debug", "1");
    if (localStorage.getItem("imai_debug") === "1") {
      const st = document.querySelector(".sim-toggle") as HTMLElement | null;
      if (st) st.style.display = "block";
    }
  } catch (_) {}
  const savedUser = localStorage.getItem("imai_user");
  const savedToken = localStorage.getItem("imai_token");
  if (savedUser && savedToken) {
    // P3：恢复会话前先验证 token（旧 OpenIM token 已失效 → 回登录页）
    fetch(API_BASE + "/api/auth/me", { headers: { "Authorization": "Bearer " + savedToken } })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(me => {
        if (!me.ok) return Promise.reject("invalid");
        currentUser = me.user_id;
        currentToken = savedToken;
        apiSetSession(me.user_id, savedToken);
        enterMainApp();
        initSDK(me.user_id, savedToken);
      })
      .catch(() => {
        localStorage.removeItem("imai_user");
        localStorage.removeItem("imai_token");
        currentUser = null;
        currentToken = null;
        document.getElementById("loginPage").classList.remove("hidden");
      });
  }
  setInterval(checkBackend, 3000);
  setInterval(loadTasks, 5000);
  setInterval(updateAIUnread, 5000);
  initSSE();   // 新增：实时事件推送（轮询保留作兑底）
  if (getTauriInvoke()) setTimeout(startBackend, 500);
};

// ============ JS 错误可见化（页面顶部红条；定位 WebView 内静默故障用） ============
window.onerror = function(msg: string | Event, src?: string, line?: number, col?: number) {
  let bar = document.getElementById("jsErrorBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "jsErrorBar";
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#d64550;color:#fff;padding:6px 10px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    (document.body || document.documentElement).appendChild(bar);
  }
  bar.textContent = "JS错误: " + msg + " @" + (src || "").split("/").pop() + ":" + line;
  return false;
};
window.addEventListener("unhandledrejection", function(e) {
  const bar = document.getElementById("jsErrorBar");
  if (bar) bar.textContent = "Promise未处理拒绝: " + String(e.reason).slice(0, 120);
});

// ============ 事件委托（替代内联 onclick；CSP 无 unsafe-inline 也能工作） ============
function escAttr(s: unknown) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _dispatchAction(el: HTMLElement) {
  const d = el.dataset;
  switch (d.action) {
    case "doLogin": doLogin(); break;
    case "logout": logout(); break;
    case "nav": go(d.view || "chat"); break;
    case "toggleTheme": toggleTheme(); break;
    case "setLanding": localStorage.setItem("imai_landing", (el as HTMLInputElement).value || "chat"); showToast("默认落地页已设为 " + (el as HTMLInputElement).value, true); break;
    case "setThemeMode": { const mv = (el as HTMLInputElement).value || "light"; localStorage.setItem("imai_theme", mv); applyTheme(mv); break; }
    case "dismissV2": { try { localStorage.setItem("imai_v2_seen", "1"); } catch (_) {} const tip = document.getElementById("v2Tip"); if (tip) tip.remove(); break; }
    case "loadGatewayConversations": loadConversations(); break; // 兼容旧调试入口
    case "loadTasks": loadTasks(); break;
    case "toggleSim": toggleSim(); break;
    case "sendSim": sendSim(); break;
    case "sendMsg": sendMsg(); break;
    case "loadApprovals": loadApprovals(); break;
    case "loadMemory": loadMemory(); break;
    case "loadSummary": loadSummary(); break;
    case "startBackend": startBackend(); break;
    case "runDiagnose": runDiagnose(); break;
    case "selectAISession": selectAISession(); break;
    case "selectConversation": selectConversation(d.convId, d.targetId, d.name, Number(d.type), el); break;
    case "confirmTask": _rejectingTaskId = null; confirmTask(Number(d.taskId)); break;
    case "rejectTask": _rejectingTaskId = Number(d.taskId); loadTasks(); break;
    case "rejectTaskReason": rejectTask(Number(d.taskId), d.reason || "其他"); break;
    case "abortReject": _rejectingTaskId = null; loadTasks(); break;
    case "editTask": editingTaskId = Number(d.taskId); loadTasks(); break;
    case "abortEdit": editingTaskId = null; loadTasks(); break;
    case "saveTaskEdit": saveTaskEdit(Number(d.taskId)); break;
    case "cancelTask": cancelTask(Number(d.taskId), el); break;
    case "completeTask": completeTask(Number(d.taskId)); break;
    case "addTermUI": addTermUI(); break;
    case "editTerm": editingTerm = d.term; loadMemory(); break;
    case "abortTermEdit": editingTerm = null; loadMemory(); break;
    case "saveTermEdit": saveTermEdit(d.term); break;
    case "deleteTerm": deleteTerm(d.term, el); break;
    case "loadMinutes": loadMinutes(); break;
    case "generateMinutes": generateMinutes(); break;
    case "minutesToTask": minutesToTask(Number(d.mid), Number(d.index)); break;
    case "runMining": runMining(); break;
    case "decideMine": decideMine(Number(d.cid), d.do, el); break;
    case "approveApproval": approveApproval(Number(d.approvalId)); break;
    case "rejectApproval": rejectApproval(Number(d.approvalId)); break;
    case "approvalFilter": loadApprovals(d.status);
      document.querySelectorAll('#panel-approval .board-tabs .tab').forEach(t => (t as HTMLElement).classList.toggle("active", (t as HTMLElement).dataset.status === d.status)); break;
    case "loadRbac": loadRbac(); break;
    case "loadRoles": loadRoles(); break;
    case "setRole": setRole(); break;
    case "loadAudit": loadAudit(); break;
    case "tab": showPanel(d.panel); if (d.loader) (window as unknown as Record<string, (() => void) | undefined>)[d.loader]?.(); break;
  }
}

document.addEventListener("click", (e) => {
  let el = e.target as HTMLElement | null;
  while (el) {
    if (el.dataset && el.dataset.action) { _dispatchAction(el); return; }
    el = el.parentElement;
  }
}, true);

// 非点击类绑定（原内联 onkeydown/onchange）
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && e.target && (e.target as HTMLElement).id === "msg") {
    e.preventDefault();
    sendMsg();
  }
});
const _quickUser = document.getElementById("quickUser");
if (_quickUser) _quickUser.addEventListener("change", swapUser);

// ============ 调试句柄（打包后内部函数不再挂 window，供控制台排查/自动化测试使用） ============
(window as unknown as Record<string, unknown>).IMAI = {
  api, loadConversations, loadTasks, loadSummary, loadRbac, loadMinutes, loadAudit,
  showPanel, renderConversations, sendMsg, go,
  getUser: () => currentUser, getToken: () => currentToken,
};
