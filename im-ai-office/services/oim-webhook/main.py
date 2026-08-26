# OpenIM 事件出口 → Redis Streams
# 接收 OpenIM Webhook 回调，转发为 message.created 事件
import os
import json
import hashlib
import hmac

import redis
from fastapi import FastAPI, Request, Header, HTTPException

app = FastAPI(title="oim-webhook")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "change_me")
STREAM = "msg"

r = redis.Redis.from_url(REDIS_URL, decode_responses=True)


def _verify(signature: str | None, body: bytes) -> bool:
    """回调鉴权。OpenIM 回调默认不携带签名头；联调试阶段放行。
    正式环境：配置 OpenIM 回调签名，并在此校验或配置鉴权 header。
    """
    # 联调/内部网络：不强制校验，避免 OpenIM 回调被 401 拒
    return True


@app.post("/callback")
async def callback(request: Request, x_signature: str | None = Header(None)):
    body = await request.body()
    if not _verify(x_signature, body):
        raise HTTPException(status_code=401, detail="bad signature")

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid json")

    # OpenIM 回调结构不同版本有差异；这里做适配层，抽取消息事件
    # 参考：afterSendGroupMsg / afterSendSingleMsg 回调（官方字段：msgID/groupID/sendID/content/contentType/sendTime）
    msg_id = data.get("msgID") or data.get("msgId") or data.get("msg_id") or f"auto_{hash(body)%10**12}"
    grp_id = data.get("groupID") or data.get("group_id") or data.get("groupid") or ""
    sender = data.get("sendID") or data.get("sender_id") or ""
    # content 可能是字符串或内嵌 JSON（OpenIM 文本/富文本）
    raw = data.get("content") or data.get("contentType") or ""
    if isinstance(raw, dict):
        content = json.dumps(raw, ensure_ascii=False)
    else:
        content = str(raw)
    # 某些版本把文本包在 content.content
    if isinstance(raw, dict) and "content" in raw:
        content = str(raw["content"])

    event = {
        "event": "message.created",
        "msgId": str(msg_id),
        "grpId": str(grp_id),
        "senderId": str(sender),
        "content": content,
        "type": data.get("contentType", "text"),
        "at": data.get("sendTime"),
    }
    r.xadd(STREAM, event)
    return {"ok": True}
