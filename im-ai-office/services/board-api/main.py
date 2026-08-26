# 任务 / 看板 REST API
import os
import json

import psycopg
from fastapi import FastAPI, Request, HTTPException, Header

app = FastAPI(title="board-api")
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://imai:imai_secret@localhost:5432/imai")
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "change_me")


def get_db():
    return psycopg.connect(DATABASE_URL)


def _auth(tok: str | None):
    if AUTH_TOKEN and AUTH_TOKEN != "change_me" and tok != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="unauthorized")
    return True


@app.get("/tasks")
def list_tasks(status: str | None = None, x_auth: str | None = Header(None)):
    _auth(x_auth)
    with get_db() as db:
        with db.cursor() as cur:
            if status:
                cur.execute("SELECT id, content, creator, assignee, deadline, status FROM task WHERE status=%s", (status,))
            else:
                cur.execute("SELECT id, content, creator, assignee, deadline, status FROM task")
            rows = cur.fetchall()
    return [
        {"id": r[0], "content": r[1], "creator": r[2], "assignee": r[3], "deadline": r[4], "status": r[5]}
        for r in rows
    ]


@app.post("/tasks/{task_id}/confirm")
def confirm(task_id: int, x_auth: str | None = Header(None)):
    _auth(x_auth)
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("UPDATE task SET status='confirmed', updated_at=now() WHERE id=%s RETURNING id", (task_id,))
            row = cur.fetchone()
        db.commit()
    if not row:
        raise HTTPException(status_code=404, detail="task not found")
    return {"ok": True, "task_id": task_id}


@app.post("/tasks/{task_id}/reject")
def reject(task_id: int, body: dict, x_auth: str | None = Header(None)):
    _auth(x_auth)
    reason = body.get("reason", "")
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(
                "UPDATE task SET status='rejected', updated_at=now() WHERE id=%s RETURNING id", (task_id,)
            )
            row = cur.fetchone()
            # 记录修正信号（供团队记忆沉淀）
            cur.execute(
                "INSERT INTO audit(actor, action, detail, task_id) VALUES('user','reject',%s,%s)",
                (json.dumps({"reason": reason}, ensure_ascii=False), task_id),
            )
        db.commit()
    if not row:
        raise HTTPException(status_code=404, detail="task not found")
    return {"ok": True, "task_id": task_id}


@app.get("/groups/{grp_id}/people")
def group_people(grp_id: int, x_auth: str | None = Header(None)):
    """看板/确认卡需要的人名字典。"""
    _auth(x_auth)
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("SELECT id, real_name, flower_name, title FROM person")
            rows = cur.fetchall()
    return [{"id": r[0], "real_name": r[1], "flower_name": r[2], "title": r[3]} for r in rows]
