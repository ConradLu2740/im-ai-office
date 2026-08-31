window.onerror = function(msg, src, line){
  document.documentElement.setAttribute("data-jserr", String(msg).slice(0,200) + " @" + String(src||"").split("/").pop() + ":" + line);
};
const API_BASE = "http://127.0.0.1:8000";
const fmt = (s) => (s == null ? "—" : s);
let tauriInvoke = null;
try { tauriInvoke = window.__TAURI__.core.invoke; } catch (e) { tauriInvoke = null; }

// 当前登录状态
let currentUser = null;
let currentToken = null;
let currentConversation = null;

let _reloginInFlight = null;

async function _relogin() {
  // 静默重签 token（/openim/login 当前无口令）；单飞防并发重放。
  // 若未来启用 IMAI_LOGIN_PASSWORD，此处会失败 → 调用方回登录页。
  if (!currentUser) return false;
  if (!_reloginInFlight) {
    _reloginInFlight = (async () => {
      try {
        const res = await _rawApi("/openim/login", { method: "POST", body: JSON.stringify({ user_id: currentUser }) });
        if (res && res.ok && res.token) {
          currentToken = res.token;
          localStorage.setItem("imai_token", res.token);
          return true;
        }
      } catch (e) {}
      return false;
    })();
  }
  const ok = await _reloginInFlight;
  _reloginInFlight = null;
  return ok;
}

async function _rawApi(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  let body = undefined;
  if (opts.body) {
    try { body = JSON.parse(opts.body); } catch (e) { body = opts.body; }
  }
  if (tauriInvoke) {
    try {
      return await tauriInvoke("api_call", { method, path, body });
    } catch (e) {
      throw new Error(`${e} (${path})`);
    }
  }
  const res = await fetch(API_BASE + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function api(path, opts = {}, _retried = false) {
  let res;
  try {
    res = await _rawApi(path, opts);
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

function showToast(msg, ok = true) {
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

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d)) return String(ts).replace("T", " ").slice(5, 16);
  const now = new Date();
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return hm;
  if (d.toDateString() === yest.toDateString()) return "昨天 " + hm;
  return String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + hm;
}

function logDebug(info) {
  const card = document.createElement("div");
  card.className = "ai-card";
  card.innerHTML = "<b>🐞 诊断信息</b><pre style='font-size:11px;color:#5a6482;'>" + JSON.stringify(info, null, 2) + "</pre>";
  document.getElementById("messages").appendChild(card);
}

function setBackendStatus(ok, text) {
  document.getElementById("statusDot").className = "dot" + (ok ? " ok" : "");
  document.getElementById("statusText").textContent = text;
}

async function startBackend() {
  if (!tauriInvoke) return showToast("当前不是桌面应用环境", false);
  setBackendStatus(false, "正在启动后端...");
  document.getElementById("startBtn").style.display = "none";
  try {
    const status = await tauriInvoke("start_backend");
    setBackendStatus(status.running, status.message);
  } catch (e) {
    setBackendStatus(false, "启动失败");
    logDebug({ action: "start_backend", error: e.message || String(e) });
    document.getElementById("startBtn").style.display = "inline-block";
  }
}

async function runDiagnose() {
  if (!tauriInvoke) return;
  try {
    const info = await tauriInvoke("diagnose");
    logDebug({ action: "diagnose", ...info });
  } catch (e) {
    logDebug({ action: "diagnose", error: e.message || String(e) });
  }
}

async function checkBackend() {
  try {
    await api("/api/tasks");
    setBackendStatus(true, "后端已连接");
  } catch (e) {
    setBackendStatus(false, "后端未启动");
    if (tauriInvoke) document.getElementById("startBtn").style.display = "inline-block";
  }
}

// ============ 登录 ============
function swapUser() {
  const sel = document.getElementById("quickUser");
  const input = document.getElementById("loginUser");
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
  const user = document.getElementById("loginUser").value.trim();
  if (!user) return showToast("请输入用户ID", false);
  const password = (document.getElementById("loginPassword") || {}).value || "";
  try {
    const res = await api("/openim/login", { method: "POST", body: JSON.stringify({ user_id: user, password }) });
    if (res.ok) {
      currentUser = user;
      currentToken = res.token;
      localStorage.setItem("imai_user", user);
      localStorage.setItem("imai_token", res.token);
      enterMainApp();
      initSDK(user, res.token);
    } else {
      showToast("登录失败：" + (res.error || ""), false);
    }
  } catch (e) {
    showToast("登录异常：" + e.message, false);
  }
}

function logout() {
  localStorage.removeItem("imai_user");
  localStorage.removeItem("imai_token");
  currentUser = null;
  currentToken = null;
  currentConversation = null;
  document.getElementById("mainApp").classList.add("hidden");
  document.getElementById("loginPage").classList.remove("hidden");
}

// ============ OpenIM SDK 实时消息 ============
let sdk = null;
let connected = false;
let msgCount = 0;
let lastMsgSeq = 0;
let pollTimer = null;

function setSDKStatus(text, ok) {
  const el = document.getElementById("sdkStatus");
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? "#1a9e6c" : "#d64550";
}

async function initSDK(userID, token) {
  // 网关凭证由后端启动时的 gateway_auto_login 管理（user001, Web/5），
  // 前端不再拿 UI token 调 /gw/login —— Web SDK 平台固定，异平台 token 会永远连不上；
  // 且 UI 登录签发的新 token 会顶掉网关旧 token（互踢）。这里只等网关就绪（最多 30s）。
  setSDKStatus("网关连接中...", false);
  let up = false;
  for (let i = 0; i < 15; i++) {
    try {
      const ping = await api("/gw/ping", { method: "GET" });
      if (ping !== undefined) { up = true; break; }
    } catch (e) {}
    setSDKStatus(`网关连接中... ${i * 2}s`, false);
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!up) { setSDKStatus("网关未就绪：请稍后重启应用重试", false); return; }
  await loadGatewayConversations();
  setSDKStatus("IM 已连接 ✅", true);
  startPoll();
}

async function loadGatewayConversations() {
  try {
    const res = await api("/gw/conversations", { method: "GET" });
    if (res.ok) renderSessions(res.conversations || []);
    else setSDKStatus("会话加载失败：" + (res.error || "") + "（可点会话栏刷新）", false);
  } catch (e) { setSDKStatus("会话加载异常：" + (e?.message||e), false); }
}

function startPoll() {
  if (pollTimer) clearInterval(pollTimer);
  let pollTick = 0;
  pollTimer = setInterval(async () => {
    try {
      const res = await api(`/gw/poll?since=${lastMsgSeq}`, { method: "GET" });
      if (res.ok && res.messages && res.messages.length) {
        res.messages.forEach(m => renderGWMessage(m));
        lastMsgSeq = res.lastSeq || lastMsgSeq;
        msgCount += res.messages.length;
        setSDKStatus(`IM 已连接 ✅ · 收 ${msgCount} 条`, true);
      }
    } catch (e) {}
    // 每 ~15s 自愈刷新一次会话列表（SDK 晚同步/中途异常都能恢复）
    if (++pollTick % 10 === 0) { try { loadGatewayConversations(); } catch (_) {} }
  }, 1500);
}

function renderSessions(convs) {
  const box = document.getElementById("sessionList");
  if (!box) return;
  // 网关 /gw/conversations 的 conversations 是 SDK 事件包装对象（真数组在 .data）；REST 路径则是数组
  const arr = Array.isArray(convs) ? convs : ((convs && convs.data) || []);
  let html = `<div class="session" id="aiSession" data-action="selectAISession">
      <div class="avatar ai">AI</div>
      <div class="session-info"><div class="session-title">AI 助手</div><div class="session-preview">任务确认与提醒</div></div>
      <div class="session-meta"><span class="badge" id="aiUnread" style="display:none">0</span></div>
    </div>`;
  html += arr.map(c => {
    const name = c.showName || (c.groupID ? `群 ${c.groupID}` : (c.userID || "会话"));
    const type = c.conversationType === 3 ? 3 : 1;
    let last = "";
    try { last = c.latestMsg ? (JSON.parse(c.latestMsg)?.textElem?.content || "") : ""; } catch (_) {}
    return `<div class="session" data-action="selectConversation" data-conv-id="${escAttr(c.conversationID)}" data-target-id="${escAttr(c.groupID || c.userID)}" data-name="${escAttr(name)}" data-type="${type}">
      <div class="avatar">${name.slice(0,1)}</div>
      <div class="session-info"><div class="session-title">${name}</div>
      <div class="session-preview">${last || "暂无消息"}</div></div>
      <div class="session-meta">${c.unreadCount ? `<span class="badge">${c.unreadCount}</span>` : ""}</div>
    </div>`;
  }).join("");
  box.innerHTML = html;
}

const _seenMsgIDs = new Set(); // 网关重启/页面重载会重放缓冲消息，按 clientMsgID 去重

function renderGWMessage(m) {
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

function renderConversationsFromSDK(convs) { renderSessions(convs || []); }

function handleSDKMessage(m) {
  renderGWMessage(m);
}

function enterMainApp() {
  document.getElementById("loginPage").classList.add("hidden");
  document.getElementById("mainApp").classList.remove("hidden");
  loadConversations();
  loadTasks();
  updateAIUnread();
}

// ============ 会话 ============
async function loadConversations() {
  // OpenIM 对刚签发 token 偶发抖动（低频 404/空响应），失败自动重试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await api("/openim/conversations", { method: "POST", body: JSON.stringify({ token: currentToken, user_id: currentUser }) });
      if (res.ok) { renderConversations(res.conversations || []); return; }
      if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue; }
      showToast("获取会话失败：" + (res.error || ""), false);
    } catch (e) {
      if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue; }
      showToast("获取会话异常：" + e.message, false);
    }
  }
}

function renderConversations(list) {
  const box = document.getElementById("sessionList");
  let html = `<div class="session" id="aiSession" data-action="selectAISession">
      <div class="avatar ai">AI</div>
      <div class="session-info">
        <div class="session-title">AI 助手</div>
        <div class="session-preview" id="aiPreview">任务确认与提醒</div>
      </div>
      <div class="session-meta"><span class="badge" id="aiUnread" style="display:none">0</span></div>
    </div>`;
  html += list.map(c => {
    const name = c.showName || (c.groupID ? `群 ${c.groupID}` : (c.userID || "未知会话"));
    const type = c.conversationType === 3 ? "群" : "单聊";
    return `<div class="session" data-action="selectConversation" data-conv-id="${escAttr(c.conversationID)}" data-target-id="${escAttr(c.groupID || c.userID)}" data-name="${escAttr(name)}" data-type="${c.conversationType}">
      <div class="avatar">${name.slice(0,1)}</div>
      <div class="session-info">
        <div class="session-title">${name}</div>
        <div class="session-preview">${type} · 点击开始聊天</div>
      </div>
    </div>`;
  }).join("");
  box.innerHTML = html;
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
    const res = await api("/api/ai_dm", { method: "GET", headers: { "Content-Type": "application/json" }, body: null });
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
    const res = await api("/api/ai_dm");
    const el = document.getElementById("aiUnread");
    const cnt = res.unread || 0;
    el.style.display = cnt ? "inline-block" : "none";
    el.textContent = cnt;
  } catch (e) {}
}

function selectConversation(convId, targetId, name, convType, el) {
  currentConversation = { id: convId, targetId, name, type: convType };
  document.getElementById("chatTitle").textContent = name;
  document.getElementById("chatSub").textContent = convType === 3 ? "群聊 · AI 旁听中" : "单聊";
  document.getElementById("messages").innerHTML = "";
  document.querySelectorAll(".session").forEach(s => s.classList.remove("active"));
  (el || event?.currentTarget)?.classList?.add("active");
  loadMessageHistory(convId);
}

async function loadMessageHistory(convId) {
  try {
    const res = await api(`/api/messages?conv_id=${encodeURIComponent(convId)}`);
    if (!res.messages || !res.messages.length) return;
    const box = document.getElementById("messages");
    box.innerHTML = "";
    (res.messages || []).forEach(m => {
      if (m.client_msg_id) _seenMsgIDs.add(m.client_msg_id);
      const self = m.is_self == 1;
      const d = document.createElement("div");
      d.className = "msg" + (self ? " self" : "");
      d.innerHTML = `<div class="avatar">${(self ? "我" : (m.sender_name || "?")).slice(0,1)}</div>
        <div><div class="msg-content">${(m.content || "").replace(/\n/g,"<br>")}</div>
        <div class="msg-meta"${self ? ' style="text-align:right;"' : ""}>${self ? "你" : (m.sender_name || "")} ${fmtTime(m.ts)}</div></div>`;
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
  } catch (e) {}
}

// ============ 消息 ============
function toggleSim() {
  const box = document.getElementById("simBox");
  box.style.display = box.style.display === "none" ? "flex" : "none";
}

async function sendSim() {
  const sender = document.getElementById("simSender").value.trim() || "同事";
  const text = document.getElementById("simText").value.trim();
  if (!text) return showToast("请输入消息内容", false);
  const convId = "sg_simulated";
  try {
    const res = await api("/api/simulate_message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sender, text, conv_id: convId }) });
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
      document.getElementById("simText").value = "";
    } else {
      showToast("模拟失败：" + (res.error || ""), false);
    }
  } catch (e) {
    showToast("模拟异常：" + e.message, false);
  }
}

async function sendMsg() {
  const input = document.getElementById("msg");
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

  // AI 助手会话：回复数字确认
  if (currentConversation.type === "ai") {
    try {
      const res = await api("/api/tasks/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sender_id: currentUser, choice: text }) });
      if (!res.ok) {
        showToast("确认失败：" + (res.error || res.reason || "无待确认任务"), false);
      } else {
        await loadAIMessages();
        loadTasks();
      }
    } catch (e) {
      showToast("确认异常：" + e.message, false);
    }
    return;
  }

  // 群聊/单聊：调网关发送（双工）
  try {
    const payload = {
      content: text,
    };
    if (currentConversation.type === 3) {
      payload.groupID = currentConversation.targetId;
    } else {
      payload.recvID = currentConversation.targetId;
    }
    // 统一去重键：/gw/send 缓冲与 /api/sdk_message 落库共用同一个 client_msg_id，
    // 避免轮询渲染与历史加载各画一份（2026-08-31 重复气泡修复）
    const cmid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(36).slice(2));
    const res = await api("/gw/send", { method: "POST", body: JSON.stringify({ ...payload, client_msg_id: cmid }) });
    if (!res.ok) {
      showToast("发送失败：" + (res.error || "网关未连接"), false);
    } else {
      // 后端 AI 识别
      try {
        const aiRes = await api("/api/sdk_message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sender: currentUser, text, conv_id: currentConversation.id, send_id: currentUser, client_msg_id: cmid }) });
        if (aiRes && aiRes.ai) { renderAICard(aiRes.ai); loadTasks(); }
      } catch(e) {}
    }
    // 发送后刷新看板
    setTimeout(loadTasks, 1500);
    updateAIUnread();
  } catch (e) {
    showToast("发送异常：" + e.message, false);
  }
}

// ============ 看板 ============
let editingTaskId = null; // 迭代2 B1：正在内联编辑的任务 id

function renderTaskCard(t) {
  const confCls = { high: "tag-high", medium: "tag-mid", low: "tag-low" };
  const isPending = t.status === "pending_confirmation";
  const isConfirmed = t.status === "confirmed";
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
    <button data-action="editTask" data-task-id="${t.id}">编辑</button>
    <button class="danger" data-action="cancelTask" data-task-id="${t.id}">取消任务</button>
  </div>` : "";
  return `
    <div class="task-card">
      <div class="task-card-title">${fmt(t.content)}</div>
      <div class="task-card-meta">
        <span>#${t.id}</span>
        <span>${fmt(t.assignee)}</span>
        <span>${fmt(t.deadline)}</span>
        ${t.confidence ? `<span class="tag ${confCls[t.confidence]||'tag-low'}">${t.confidence}</span>` : ""}
      </div>
      ${proofs.length ? `<div class="task-proof">依据：${esc(proofs.join("；"))}</div>` : ""}
      ${isPending ? `<div class="ai-card-btns" style="margin-top:10px;">
        <button class="primary" data-action="confirmTask" data-task-id="${t.id}">确认</button>
        <button class="danger" data-action="rejectTask" data-task-id="${t.id}">驳回</button>
      </div>` : ""}
      ${confirmedBtns}
      ${editHtml}
    </div>
  `;
}

async function confirmTask(id) {
  await api(`/api/tasks/${id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  loadTasks();
}

async function rejectTask(id) {
  await api(`/api/tasks/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "负责人错了" }) });
  loadTasks();
}

async function saveTaskEdit(id) {
  const assignee = (document.getElementById("editAssignee").value || "").trim();
  const dl = document.getElementById("editDeadline").value || ""; // "YYYY-MM-DDTHH:MM"
  const body = {};
  if (assignee) body.assignee = assignee;
  if (dl) body.deadline = dl.replace("T", " ");
  try {
    await api(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    editingTaskId = null;
    loadTasks();
    showToast("任务已更新" + (body.deadline ? "，提醒已按新时间重算" : ""), true);
  } catch (e) {
    showToast("更新失败：" + e.message, false);
  }
}

async function cancelTask(id, btn) {
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
    showToast("取消失败：" + e.message, false);
  }
}

async function loadTasks() {
  try {
    const data = await api("/api/tasks");
    const pendingAssignee = data.tasks.filter(t => t.status === "pending_assignee");
    const pending = data.tasks.filter(t => t.status === "pending_confirmation");
    const confirmed = data.tasks.filter(t => t.status === "confirmed");
    document.getElementById("countPendingAssignee").textContent = pendingAssignee.length;
    document.getElementById("countPending").textContent = pending.length;
    document.getElementById("countConfirmed").textContent = confirmed.length;
    document.getElementById("listPendingAssignee").innerHTML = pendingAssignee.map(renderTaskCard).join("") || "<div style='color:#8f959e;font-size:12px;'>暂无待指派任务</div>";
    document.getElementById("listPending").innerHTML = pending.map(renderTaskCard).join("") || "<div style='color:#8f959e;font-size:12px;'>暂无待确认任务</div>";
    document.getElementById("listConfirmed").innerHTML = confirmed.map(renderTaskCard).join("") || "<div style='color:#8f959e;font-size:12px;'>暂无已确认任务</div>";
    setBackendStatus(true, "后端已连接");
  } catch (e) {
    setBackendStatus(false, "后端未连接");
  }
}

// ============ M3/M4 前端面板 ============
function showPanel(name) {
  document.getElementById("panel-board").style.display = name === "board" ? "" : "none";
  document.getElementById("panel-approval").style.display = name === "approval" ? "" : "none";
  document.getElementById("panel-memory").style.display = name === "memory" ? "" : "none";
  document.getElementById("panel-summary").style.display = name === "summary" ? "" : "none";
  document.querySelectorAll(".board-tabs .tab").forEach(t => {
    t.classList.toggle("active", t.dataset.panel === name);
  });
}

async function loadSummary() {
  const box = document.getElementById("summaryBox");
  try {
    const data = await api("/api/summary/daily");
    const text = (data.text || "").replace(/\n/g, "<br>");
    box.innerHTML = `<div class="summary-text">${esc(text)}</div>`;
  } catch (e) {
    box.innerHTML = `<div class='approval-empty'>生成失败：${esc(e.message)}</div>`;
  }
}

async function loadApprovals() {
  const box = document.getElementById("approvalList");
  try {
    const data = await api("/api/approvals?status=pending");
    const list = data.approvals || [];
    if (!list.length) {
      box.innerHTML = "<div class='approval-empty'>暂无待审批的高风险动作 ✅</div>";
      return;
    }
    box.innerHTML = list.map(a => {
      let detail = "";
      try { detail = JSON.stringify(JSON.parse(a.detail), null, 2); } catch(e) { detail = a.detail; }
      return `<div class="approval-item">
        <div class="a-head"><span class="a-action">${esc(a.action)}</span><span style="font-size:11px;color:#8f959e;">#${a.id}</span></div>
        <div class="a-detail">${esc(detail)}</div>
        <div class="a-btns">
          <button class="a-yes" data-action="approveApproval" data-approval-id="${a.id}">批准</button>
          <button class="a-no" data-action="rejectApproval" data-approval-id="${a.id}">拒绝</button>
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    box.innerHTML = `<div class='approval-empty'>加载失败：${esc(e.message)}</div>`;
  }
}

async function approveApproval(id) {
  try {
    const r = await api(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ approved: true }) });
    showToast(r.ok ? "已批准" : "批准失败：" + (r.error || ""), r.ok);
    loadApprovals(); loadTasks();
  } catch (e) { showToast("批准异常：" + e.message, false); }
}

async function rejectApproval(id) {
  try {
    const r = await api(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ approved: false }) });
    showToast(r.ok ? "已拒绝" : "拒绝失败：" + (r.error || ""), r.ok);
    loadApprovals();
  } catch (e) { showToast("拒绝异常：" + e.message, false); }
}

async function loadMemory() {
  const box = document.getElementById("memoryHtml");
  try {
    const data = await api("/api/memory");
    const terms = data.memory.terms || [];
    const gm = data.memory.grp_meta;
    let html = "";
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
        return `<div class="memory-term"><b>${esc(t.term)}</b> = ${esc(t.meaning)} <span style="color:#8f959e;font-size:11px;">[${esc(t.source)}]</span>
          <button data-action="editTerm" data-term="${escAttr(t.term)}" style="margin-left:6px;">✎</button>
          <button class="danger" data-action="deleteTerm" data-term="${escAttr(t.term)}" style="margin-left:2px;">🗑</button></div>`;
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
  // 会话下拉：与纪要页同源缓存（/gw/conversations），空则拉一次
  if (!_minutesConvs.length) {
    try {
      const res = await api("/gw/conversations", { method: "GET" });
      if (res.ok) {
        const arr = Array.isArray(res.conversations) ? res.conversations : ((res.conversations && res.conversations.data) || []);
        _minutesConvs = arr.map(c => ({ id: c.conversationID, name: c.showName || (c.groupID ? `群 ${c.groupID}` : (c.userID || "会话")) }));
      }
    } catch (_) {}
  }
  const sel = document.getElementById("mineConv");
  if (sel && _minutesConvs.length) {
    const cur = sel.value;
    sel.innerHTML = _minutesConvs.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join("");
    if (cur && _minutesConvs.some(c => c.id === cur)) sel.value = cur;
  }
  loadMineCandidates();
}

function _mineSummary(c) {
  const p = c.payload || {};
  if (c.kind === "term") return `术语 <b>${esc(p.term)}</b> = ${esc(p.meaning)}`;
  if (c.kind === "alias") return `称呼 <b>${esc(p.real_name)}</b> ← ${esc(p.alias)}`;
  if (c.kind === "task") return `任务 <b>${esc(p.content)}</b>${p.assignee_hint ? `（${esc(p.assignee_hint)}）` : ""}${p.deadline_hint ? ` [${esc(p.deadline_hint)}]` : ""}`;
  return esc(c.kind);
}

const _MINE_KIND_LABEL = { term: "术语", alias: "称呼", task: "任务" };

async function loadMineCandidates() {
  const box = document.getElementById("mineCands");
  if (!box) return;
  try {
    const data = await api("/api/mine/candidates");
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
    box.innerHTML = `<div style="color:#8f959e;font-size:12px;padding:8px;">加载失败：${esc(e.message)}</div>`;
  }
}

async function runMining() {
  const convId = document.getElementById("mineConv").value;
  const limit = Number(document.getElementById("mineLimit").value) || 500;
  if (!convId) { showToast("请先选择会话", false); return; }
  showToast("挖掘中…（LLM 分批处理，可能需要十几秒）", true);
  try {
    const r = await api("/api/mine/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conv_id: convId, limit }) });
    const k = r.by_kind || {};
    showToast(`挖掘完成：术语 ${k.term || 0} · 称呼 ${k.alias || 0} · 任务 ${k.task || 0}${r.skipped_batches ? `（跳过 ${r.skipped_batches} 批）` : ""}`, true);
    loadMineCandidates();
  } catch (e) {
    showToast("挖掘失败：" + e.message, false);
  }
}

async function decideMine(cid, action, btn) {
  // 两步确认：拒绝需二次点击，防误触
  if (action === "reject" && btn.dataset.armed !== "1") {
    btn.dataset.armed = "1"; btn.textContent = "确认拒绝";
    setTimeout(() => { btn.dataset.armed = ""; btn.textContent = "拒绝"; }, 3000);
    return;
  }
  try {
    const r = await api(`/api/mine/candidates/${cid}/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    showToast(action === "accept" ? "已入库" : "已拒绝", true);
    loadMineCandidates();
    if (action === "accept" && r.result && r.result.taskId) {
      showToast(`任务 #${r.result.taskId} 已进看板待确认`, true);
    }
  } catch (e) {
    showToast("操作失败：" + e.message, false);
  }
}

// ============ 迭代2 B3：术语手动增删改 ============
let editingTerm = null; // 正在内联编辑释义的术语

async function addTermUI() {
  const term = (document.getElementById("newTerm").value || "").trim();
  const meaning = (document.getElementById("newTermMeaning").value || "").trim();
  if (!term || !meaning) { showToast("术语和含义都要填", false); return; }
  try {
    await api("/api/term/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term, meaning }) });
    loadMemory();
    showToast("术语已添加", true);
  } catch (e) {
    showToast("添加失败：" + e.message, false);
  }
}

async function saveTermEdit(term) {
  const meaning = (document.getElementById("editTermMeaning").value || "").trim();
  if (!meaning) { showToast("含义不能为空", false); return; }
  try {
    await api(`/api/term/${encodeURIComponent(term)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meaning }) });
    editingTerm = null;
    loadMemory();
    showToast("术语已更新", true);
  } catch (e) {
    showToast("更新失败：" + e.message, false);
  }
}

async function deleteTerm(term, btn) {
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
    showToast("删除失败：" + e.message, false);
  }
}

// ============ 迭代2 B2：会议纪要 ============
let _minutesConvs = []; // {id, name} 缓存，供下拉与卡片显示会话名

async function loadMinutes() {
  // 会话下拉：与左侧会话列表同源（/gw/conversations）
  try {
    const res = await api("/gw/conversations", { method: "GET" });
    if (res.ok) {
      const arr = Array.isArray(res.conversations) ? res.conversations : ((res.conversations && res.conversations.data) || []);
      _minutesConvs = arr.map(c => ({ id: c.conversationID, name: c.showName || (c.groupID ? `群 ${c.groupID}` : (c.userID || "会话")) }));
    }
  } catch (_) {}
  const sel = document.getElementById("minutesConv");
  if (sel && _minutesConvs.length) {
    const cur = sel.value;
    sel.innerHTML = _minutesConvs.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join("");
    if (cur && _minutesConvs.some(c => c.id === cur)) sel.value = cur;
  }
  // 历史纪要列表
  const box = document.getElementById("minutesList");
  try {
    const data = await api("/api/minutes");
    const list = data.minutes || [];
    if (!list.length) {
      box.innerHTML = `<div style="color:#8f959e;font-size:12px;">还没有纪要，选会话后点「生成纪要」</div>`;
      return;
    }
    const convName = id => { const c = _minutesConvs.find(x => x.id === id); return c ? c.name : id; };
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
    box.innerHTML = `<div class='approval-empty'>加载失败：${esc(e.message)}</div>`;
  }
}

async function generateMinutes() {
  const convId = document.getElementById("minutesConv").value;
  const limit = Number(document.getElementById("minutesLimit").value) || 50;
  if (!convId) { showToast("请先选择会话", false); return; }
  showToast("正在生成纪要…（LLM 需要几秒）", true);
  try {
    await api("/api/minutes/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conv_id: convId, limit }) });
    loadMinutes();
    showToast("纪要已生成", true);
  } catch (e) {
    showToast("生成失败：" + e.message, false);
  }
}

async function minutesToTask(mid, index) {
  try {
    const r = await api(`/api/minutes/${mid}/task`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index }) });
    showToast(`已转入看板待确认（任务 #${r.taskId}）`, true);
  } catch (e) {
    showToast("转任务失败：" + e.message, false);
  }
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
}

function renderAICard(r) {
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

// Step2 实时事件（SSE，后端 async 模式才有事件；sync 模式下 EventSource 会静默重试、无影响）
let esAI = null;
function initSSE() {
  if (!window.EventSource || esAI) return;
  try {
    esAI = new EventSource(API_BASE + "/api/events/stream");
    esAI.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "task_created" || ev.type === "ai.card") loadTasks();
        if (ev.type === "task_created") updateAIUnread();
      } catch (_) {}
    };
    // EventSource 断线自动重连；无需手动重建
  } catch (_) { esAI = null; }
}

// 初始化
window.onload = () => {
  const savedUser = localStorage.getItem("imai_user");
  const savedToken = localStorage.getItem("imai_token");
  if (savedUser && savedToken) {
    currentUser = savedUser;
    currentToken = savedToken;
    enterMainApp();
    initSDK(savedUser, savedToken);
  }
  setInterval(checkBackend, 3000);
  setInterval(loadTasks, 5000);
  setInterval(updateAIUnread, 5000);
  initSSE();   // 新增：实时事件推送（轮询保留作兑底）
  if (tauriInvoke) setTimeout(startBackend, 500);
};

// ============ JS 错误可见化（页面顶部红条；定位 WebView 内静默故障用） ============
window.onerror = function(msg, src, line, col) {
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
function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _dispatchAction(el) {
  const d = el.dataset;
  switch (d.action) {
    case "doLogin": doLogin(); break;
    case "logout": logout(); break;
    case "loadGatewayConversations": loadGatewayConversations(); break;
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
    case "confirmTask": confirmTask(Number(d.taskId)); break;
    case "rejectTask": rejectTask(Number(d.taskId)); break;
    case "editTask": editingTaskId = Number(d.taskId); loadTasks(); break;
    case "abortEdit": editingTaskId = null; loadTasks(); break;
    case "saveTaskEdit": saveTaskEdit(Number(d.taskId)); break;
    case "cancelTask": cancelTask(Number(d.taskId), el); break;
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
    case "tab": showPanel(d.panel); if (d.loader && window[d.loader]) window[d.loader](); break;
  }
}

document.addEventListener("click", (e) => {
  let el = e.target;
  while (el && el !== document) {
    if (el.dataset && el.dataset.action) { _dispatchAction(el); return; }
    el = el.parentElement;
  }
}, true);

// 非点击类绑定（原内联 onkeydown/onchange）
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && e.target && e.target.id === "msg") {
    e.preventDefault();
    sendMsg();
  }
});
const _quickUser = document.getElementById("quickUser");
if (_quickUser) _quickUser.addEventListener("change", swapUser);
