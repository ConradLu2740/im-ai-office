#!/usr/bin/env node
// OpenIM 消息网关：跑 OpenIM SDK 连接 WebSocket，暴露本地 HTTP，实现双工收发。
// HTTP 接口(127.0.0.1:8400)：
//   POST /gw/login {userID, token}      连接 OpenIM
//   GET  /gw/conversations              会话列表
//   GET  /gw/poll?since=NN              增量新消息
//   POST /gw/send {groupID|recvID, content}  发消息
//   POST /gw/logout                     断开
const http = require('http');
const { getSDK, CbEvents } = require('@openim/client-sdk');

const PORT = 8400;
const WS_ADDR = process.env.OPENIM_WS || 'ws://127.0.0.1:10001';
const API_ADDR = process.env.OPENIM_API || 'http://127.0.0.1:10002';
const BACKEND_API = process.env.BACKEND_API || 'http://127.0.0.1:8000';

let sdk = null;
let connected = false;
let userID = null;
let msgSeq = 0;        // 本地消息序号，供增量轮询
const msgBuffer = [];   // 缓存新消息

function sdkInit() {
  sdk = getSDK();
  const { CbEvents: CB } = { CbEvents };
  sdk.on(CB.OnConnectSuccess, () => { connected = true; console.log('[gw] connected'); });
  sdk.on(CB.OnConnectFailed, (e) => { connected = false; console.log('[gw] connect failed', e); });
  sdk.on(CB.OnRecvNewMessages, ({ data }) => {
    if (data && data.length) {
      data.forEach(m => {
        const content = m.textElem?.content || m.content || '';
        const item = {
          seq: ++msgSeq,
          sendID: m.sendID,
          senderNickname: m.senderNickname || m.sendID,
          groupID: m.groupID || '',
          conversationID: m.groupID ? 'sg_' + m.groupID : '',
          content,
          sendTime: m.sendTime || Date.now(),
          textElem: m.textElem || null,
        };
        msgBuffer.push(item);
        console.log('[gw] recv msg:', item.senderNickname, content);
        // 联动后端 AI 识别 + 入库（AI 旁听）
        if (content) {
          fetch(BACKEND_API + '/api/sdk_message', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender: item.senderNickname, text: content, conv_id: item.conversationID, send_id: item.sendID })
          }).then(r => r.json()).then(res => {
            if (res && res.ai) console.log('[gw] AI action:', res.ai.action);
          }).catch(e => console.log('[gw] AI sync err', e));
        }
      });
    }
  });
}

async function readBody(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch(e) { res({}); } });
    req.on('error', rej);
  });
}

function json(res, obj, code=200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;
  try {
    // CORS 放行（桌面应用内嵌 WebView 调用）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return json(res, {});

    if (path === '/gw/ping') {
      return json(res, { ok:true, connected });
    }

    if (path === '/gw/login' && req.method === 'POST') {
      const body = await readBody(req);
      const { userID: uid, token } = body;
      if (!uid || !token) return json(res, { ok:false, error:'userID/token required' }, 400);
      if (sdk) { try { sdk.reset(); } catch(e){} }
      sdkInit();
      userID = uid;
      msgSeq = 0; msgBuffer.length = 0;
      await sdk.login({ userID: uid, token, platformID: 5, wsAddr: WS_ADDR, apiAddr: API_ADDR });
      return json(res, { ok:true, userID: uid });
    }

    if (path === '/gw/conversations' && req.method === 'GET') {
      if (!sdk || !connected) return json(res, { ok:false, error:'not connected' }, 400);
      const convs = await sdk.getConversationListSplit({ offset:0, count:100 });
      return json(res, { ok:true, conversations: convs || [] });
    }

    if (path === '/gw/poll' && req.method === 'GET') {
      const since = parseInt(url.searchParams.get('since') || '0', 10);
      const newMsgs = msgBuffer.filter(m => m.seq > since);
      const lastSeq = msgBuffer.length ? msgBuffer[msgBuffer.length-1].seq : since;
      return json(res, { ok:true, messages:newMsgs, lastSeq, connected });
    }

    if (path === '/gw/send' && req.method === 'POST') {
      const body = await readBody(req);
      if (!sdk || !connected) return json(res, { ok:false, error:'not connected' }, 400);
      const { groupID, recvID, content } = body;
      if (!content) return json(res, { ok:false, error:'content required' }, 400);
      const message = (await sdk.createTextMessage(content)).data;
      const resp = await sdk.sendMessage({ recvID: recvID||'', groupID: groupID||'', message });
      // 也记入本地（自己发的）
      const item = { seq: ++msgSeq, sendID: userID, senderNickname:'我', groupID: groupID||'', conversationID: groupID?'sg_'+groupID:'', content, sendTime: Date.now() };
      msgBuffer.push(item);
      return json(res, { ok:true, serverMsgID: resp?.serverMsgID || '' });
    }

    if (path === '/gw/logout' && req.method === 'POST') {
      if (sdk) { try { sdk.reset(); } catch(e){} }
      connected = false; sdk = null; userID = null;
      return json(res, { ok:true });
    }

    json(res, { ok:false, error:'not found ' + path }, 404);
  } catch (e) {
    console.log('[gw] err', e);
    json(res, { ok:false, error: e?.message || String(e), detail: e?.stack }, 500);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[gw] OpenIM 消息网关启动 http://127.0.0.1:${PORT}`);
  console.log(`[gw] ws=${WS_ADDR} api=${API_ADDR}`);
});
