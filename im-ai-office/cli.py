#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IMAI 办公助手 · headless CLI

复刻 Tauri 编排层（Rust lib.rs 的 start_backend / start_gateway / diagnose），
让我（Agent）和你都能在不打开 GUI 的情况下，用命令行复现并驱动整条链路：

  后端   FastAPI       → http://127.0.0.1:8000
  网关   Node + OpenIM SDK → http://127.0.0.1:8400

同时修正了 Tauri 源码布局下「找不到网关 bundle」的路径 bug：
  网关文件实际在 desktop/src/msg_gateway.bundle.cjs，
  Rust 源码布局却默认从仓库根（im-ai-office/）找，导致 GUI 里网关起不来。

用法：
  python3 cli.py status                       # 只读诊断：路径/依赖/后端/网关/OpenIM
  python3 cli.py up [--gateway] [--no-gateway]# 启动后端（默认连带拉起网关）
  python3 cli.py down                          # 停止本 CLI 启动的后端+网关
  python3 cli.py chain [--user 13800138000]    # 一键驱动链路: 后端→网关→login→conversations→send→poll
  python3 cli.py help
"""
import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent          # im-ai-office/
BACKEND_PORT = 8000
GATEWAY_PORT = 8400


def load_env(path: Path = ROOT / ".env") -> None:
    """把 .env 的键值注入 os.environ（不覆盖已存在的变量）。
    后端依赖 python-dotenv；CLI 保持零依赖，这里用简单解析。"""
    if not path.exists():
        return
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except Exception:
        pass


load_env()

# 网关 bundle 候选（按优先级），修复 Tauri 源码布局路径 bug
GATEWAY_CANDIDATES = [
    ROOT / "desktop" / "src" / "msg_gateway.bundle.cjs",
    ROOT / "desktop" / "msg_gateway.cjs",
    ROOT / "msg_gateway.bundle.cjs",
    ROOT / "desktop" / "src-tauri" / "target" / "debug" / "backend" / "msg_gateway.bundle.cjs",
    ROOT / "desktop" / "src-tauri" / "target" / "release" / "backend" / "msg_gateway.bundle.cjs",
]


def find_gateway() -> Optional[Path]:
    for cand in GATEWAY_CANDIDATES:
        if cand.exists():
            return cand
    return None


def which(cmd: str) -> Optional[str]:
    return shutil.which(cmd)


def http_json(method: str, url: str, body=None, timeout: float = 3.0) -> dict:
    """发 HTTP 请求，返回 dict；失败抛异常，但会读入响应体便于诊断。"""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return {"ok": False, "_status": e.code, **json.loads(raw)}
        except Exception:
            return {"ok": False, "_status": e.code, "_raw": raw}
    except Exception as e:
        return {"ok": False, "_error": str(e)}
    try:
        return json.loads(raw)
    except Exception:
        return {"_raw": raw}


def backend_alive() -> bool:
    try:
        r = http_json("GET", f"http://127.0.0.1:{BACKEND_PORT}/api/tasks", timeout=2.0)
        return "tasks" in r
    except Exception:
        return False


def gateway_alive() -> bool:
    try:
        r = http_json("GET", f"http://127.0.0.1:{GATEWAY_PORT}/gw/ping", timeout=2.0)
        return r.get("ok", False)
    except Exception:
        return False


def read_log(path: str, max_lines: int = 30) -> str:
    p = Path(path)
    if not p.exists():
        return "(无日志)"
    lines = p.read_text(errors="replace").splitlines()
    return "\n".join(lines[-max_lines:]) if lines else "(空日志)"


# ---------------- 诊断 ----------------
def cmd_status(args) -> int:
    py = which("python3") or "python3"
    node = which("node") or which("nodejs") or "node"
    gw = find_gateway()
    env = dict(os.environ)

    print("=== IMAI 链路诊断 ===")
    print(f"仓库根           : {ROOT}")
    print(f"python3          : {py}")
    print(f"node             : {node}")
    print(f"app.py 存在      : {(ROOT/'app.py').exists()}")
    print(f"core.py 存在     : {(ROOT/'core.py').exists()}")
    print(f"openim_client.py : {(ROOT/'openim_client.py').exists()}")
    print(f".env 存在        : {(ROOT/'.env').exists()}")
    print(f"网关 bundle      : {gw if gw else '未找到'}")
    print(f"后端(:{BACKEND_PORT})        : {'运行中' if backend_alive() else '未运行'}")
    print(f"网关(:{GATEWAY_PORT})        : {'运行中' if gateway_alive() else '未运行'}")

    print("\n--- OpenIM 相关环境变量（脱敏）---")
    for k in ("OPENIM_API", "OPENIM_WS", "OPENIM_ADMIN_TOKEN", "OPENIM_SENDER_ID",
              "OPENIM_SECRET", "LLM_BASE", "LLM_MODEL", "LLM_API_KEY",
              "DATABASE_URL", "REDIS_URL", "AUTH_TOKEN"):
        v = env.get(k)
        if v:
            masked = v if len(v) <= 12 else v[:6] + "…" + v[-4:]
            print(f"  {k} = {masked}")
        else:
            print(f"  {k} = (未设置)")

    print("\n--- 后端日志尾 (/tmp/imai-backend.log) ---")
    print(read_log("/tmp/imai-backend.log"))
    print("\n--- 网关日志尾 (/tmp/imai-gateway.log) ---")
    print(read_log("/tmp/imai-gateway.log"))
    return 0


# ---------------- 启动 ---------------
_spawned: list[subprocess.Popen] = []


def start_backend() -> bool:
    if backend_alive():
        print(f"[up] 后端已在运行 (: {BACKEND_PORT})")
        return True
    py = which("python3") or "python3"
    log = open("/tmp/imai-backend.log", "a")
    print(f"[up] 启动后端: {py} app.py (cwd={ROOT}) ...")
    proc = subprocess.Popen(
        [py, "app.py"],
        cwd=str(ROOT),
        stdout=log,
        stderr=log,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    _spawned.append(proc)
    for _ in range(60):
        time.sleep(0.5)
        if backend_alive():
            print(f"[up] 后端就绪 (: {BACKEND_PORT})")
            return True
    print("[up] 后端启动超时，见 /tmp/imai-backend.log")
    return False


def start_gateway() -> bool:
    if gateway_alive():
        print(f"[up] 网关已在运行 (: {GATEWAY_PORT})")
        return True
    gw = find_gateway()
    if not gw:
        print("[up] 网关 bundle 未找到，跳过")
        return False
    node = which("node") or which("nodejs") or "node"
    log = open("/tmp/imai-gateway.log", "a")
    print(f"[up] 启动网关: {node} {gw} ...")
    proc = subprocess.Popen(
        [node, str(gw)],
        cwd=str(gw.parent),
        stdout=log,
        stderr=log,
    )
    _spawned.append(proc)
    for _ in range(20):
        time.sleep(0.5)
        if gateway_alive():
            print(f"[up] 网关就绪 (: {GATEWAY_PORT})")
            return True
    print("[up] 网关启动超时，见 /tmp/imai-gateway.log")
    return False


def cmd_up(args) -> int:
    ok_backend = start_backend()
    ok_gw = False
    if args.no_gateway:
        print("[up] 按 --no-gateway 跳过网关")
    else:
        ok_gw = start_gateway()
    print(f"\n=> 后端 {'OK' if ok_backend else 'FAIL'} · 网关 {'OK' if ok_gw else 'FAIL'}")
    return 0 if ok_backend else 1


def cmd_down(args) -> int:
    for proc in list(_spawned):
        if proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
            print(f"[down] 停止 pid {proc.pid}")
    _spawned.clear()
    # 若直接跑 curl 无进程句柄，提示手动
    print("[down] 提示：若后端/网关是别处启动的，请用对应方式停止")
    return 0


# ---------------- 链路驱动 ----------------
def cmd_chain(args) -> int:
    # 登录身份：用普通用户（imAdmin 是 admin 平台账号，OpenIM 拒绝给 admin 发 user token）
    login_user = os.environ.get("OPENIM_LOGIN_USER", "user001")
    user = args.user or login_user
    token = args.token or os.environ.get("OPENIM_ADMIN_TOKEN") or ""
    group = args.group or ""
    gw_base = f"http://127.0.0.1:{GATEWAY_PORT}"

    if not backend_alive():
        print("[chain] 后端未运行，请先 `python3 cli.py up`")
        return 1
    if not gateway_alive():
        print("[chain] 网关未运行，请先 `python3 cli.py up`")
        return 1

    # 1) 后端 /openim/login 拿 token
    print(f"[chain] 1. 后端登录 user={user}")
    try:
        r = http_json("POST", f"http://127.0.0.1:{BACKEND_PORT}/openim/login",
                      {"user_id": user}, timeout=8)
        print("   res:", json.dumps(r, ensure_ascii=False))
        if r.get("ok"):
            token = r.get("token", token)
    except Exception as e:
        print("   登录失败:", e)

    # 2) 网关 login
    print("[chain] 2. 网关 login")
    r = http_json("POST", f"{gw_base}/gw/login", {"userID": user, "token": token}, timeout=10)
    print("   res:", json.dumps(r, ensure_ascii=False))
    if not r.get("ok"):
        print("[chain] 网关登录失败，OpenIM 服务端可能未运行")
        return 1

    # 3) 网关 conversations
    print("[chain] 3. 会话列表")
    r = http_json("GET", f"{gw_base}/gw/conversations", timeout=8)
    print("   res:", json.dumps(r, ensure_ascii=False))

    # 4) 发送一条（有 group 则发群，否则发收件人）
    text = args.text or "AI 无头链路自检消息"
    print(f"[chain] 4. 发消息 content='{text}'")
    r = http_json("POST", f"{gw_base}/gw/send",
                  {"groupID": group, "recvID": group or user, "content": text}, timeout=8)
    print("   res:", json.dumps(r, ensure_ascii=False))

    # 5) 轮询接收
    print("[chain] 5. 轮询 3s 等待回流...")
    since = 0
    recv_items = []
    for _ in range(6):
        time.sleep(0.5)
        try:
            r = http_json("GET", f"{gw_base}/gw/poll?since={since}", timeout=5)
            msgs = r.get("messages", [])
            if msgs:
                recv_items.extend(msgs)
                since = r.get("lastSeq", since)
        except Exception:
            pass
        if recv_items:
            break
    print("   收:", json.dumps(recv_items, ensure_ascii=False))

    print("\n=== chain 完成 ===")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="cli.py", description="IMAI headless CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="只读诊断").set_defaults(func=cmd_status)
    sub.add_parser("help", help="帮助")

    p_up = sub.add_parser("up", help="启动后端（默认连带拉起网关）")
    p_up.add_argument("--no-gateway", action="store_true", help="只启动后端，不拉网关")
    p_up.set_defaults(func=cmd_up)

    p_down = sub.add_parser("down", help="停止本 CLI 启动的进程")
    p_down.set_defaults(func=cmd_down)

    p_chain = sub.add_parser("chain", help="驱动完整链路: login→conversations→send→poll")
    p_chain.add_argument("--user", default=None)
    p_chain.add_argument("--token", default=None)
    p_chain.add_argument("--group", default="")
    p_chain.add_argument("--text", default=None)
    p_chain.set_defaults(func=cmd_chain)

    args = parser.parse_args()
    func = getattr(args, "func", None)
    if args.cmd in ("help", None):
        parser.print_help()
        return 0
    return func(args)


if __name__ == "__main__":
    sys.exit(main())
