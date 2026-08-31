#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数据层：SQLite / Postgres 双后端（Step3）

分派规则：env DATABASE_URL 以 postgres 开头 → psycopg2 后端；否则 SQLite（IMAI_DB）。

PgCursor 翻译层（业务 SQL 保持 SQLite 习惯写法 `?`，语义差异在此集中）：
- ? → %s
- datetime('now') → NOW()
- datetime('now', ?) → NOW() + (%s)::interval   （参数传 '-N seconds'，双端语义一致）
- INSERT OR REPLACE INTO event_dedup(msg_id) VALUES(?) → ON CONFLICT DO UPDATE
- RETURNING id → lastrowid（SQLite 原生支持 RETURNING，双方言统一取值路径）

已知差异点（显式分支，不进翻译器）：bus.is_duplicate 的窗口参数、audit_recent 排序键。
"""
import os
import re
import sqlite3

# ============ 后端探测 ============

def _detect():
    """后端优先级：显式 IMAI_DB → SQLite；否则 DATABASE_URL 为 postgres → PG。
    （测试/开发默认 SQLite；切 PG = 移除 IMAI_DB 并设置 DATABASE_URL，见 Spec §2）"""
    sqlite_file = os.environ.get("IMAI_DB",
                                 os.path.join(os.path.dirname(__file__) or ".", "imai.db"))
    url = os.environ.get("DATABASE_URL", "")
    if url.startswith("postgres") and not os.environ.get("IMAI_DB"):
        return "postgres", url
    return "sqlite", sqlite_file

BACKEND, DATABASE_URL = _detect()
SQLITE_FILE = os.environ.get("IMAI_DB",
                          os.path.join(os.path.dirname(__file__) or ".", "imai.db"))

POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS person(id BIGSERIAL PRIMARY KEY, real_name TEXT, flower_name TEXT, title TEXT, group_id INTEGER);
CREATE TABLE IF NOT EXISTS alias(person_id INTEGER, name TEXT);
CREATE TABLE IF NOT EXISTS task(id BIGSERIAL PRIMARY KEY, content TEXT, creator TEXT,
                  assignee TEXT, deadline TEXT, deadline_at TIMESTAMPTZ,
                  status TEXT, confidence TEXT, source_msg TEXT, pending_meta TEXT,
                  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS audit(id BIGSERIAL PRIMARY KEY, actor TEXT, action TEXT, detail TEXT, ts TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS ai_dm(id BIGSERIAL PRIMARY KEY, sender_id TEXT, direction TEXT, content TEXT, task_id INTEGER, read_flag INTEGER DEFAULT 0, ts TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS message(id BIGSERIAL PRIMARY KEY, conv_id TEXT, sender_id TEXT, sender_name TEXT, content TEXT, content_type INTEGER DEFAULT 101, is_self INTEGER DEFAULT 0, msg_seq INTEGER, client_msg_id TEXT, ts TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS role(oim_user_id TEXT PRIMARY KEY, role TEXT DEFAULT 'member', updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS approval(id BIGSERIAL PRIMARY KEY, actor TEXT, action TEXT, detail TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), decided_at TIMESTAMPTZ, decided_by TEXT);
CREATE TABLE IF NOT EXISTS term(id BIGSERIAL PRIMARY KEY, term TEXT UNIQUE NOT NULL, meaning TEXT NOT NULL, source TEXT DEFAULT 'manual', created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS grp_meta(oim_group_id TEXT PRIMARY KEY, intro TEXT DEFAULT '', ai_enabled INTEGER DEFAULT 1, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS event_dedup(msg_id TEXT PRIMARY KEY, consumed_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS reminder_sent(id BIGSERIAL PRIMARY KEY, task_id INTEGER, tier TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(task_id, tier));
CREATE TABLE IF NOT EXISTS minutes(id BIGSERIAL PRIMARY KEY, conv_id TEXT, title TEXT, summary TEXT,
                   decisions TEXT, action_items TEXT, msg_count INTEGER DEFAULT 0,
                   created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS mine_candidate(id BIGSERIAL PRIMARY KEY, conv_id TEXT, kind TEXT,
                     payload TEXT, evidence TEXT, msg_count INTEGER DEFAULT 0,
                     status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(),
                     decided_at TIMESTAMPTZ, decided_by TEXT);
"""

SEED_PERSONS = [
    (1, "张伟", "小张", "产品经理", 100),
    (2, "张敏", "小张", "市场专员", 100),
    (3, "李娜", "娜姐", "运营", 100),
]
SEED_ALIASES = [(1, "小张"), (1, "张伟"), (2, "小张"), (2, "张敏"), (3, "娜姐")]


# ============ Postgres 翻译游标 ============

def _translate_pg(sql: str) -> str:
    # 顺序关键：先替换带 ? 的 datetime 特例，再做 ?→%s 兜底
    s = sql.replace("datetime('now', ?)", "NOW() + (%s)::interval")
    s = s.replace("?", "%s")
    s = s.replace("datetime('now')", "NOW()")
    # INSERT OR REPLACE（唯一用点：event_dedup 主键去重）
    s = s.replace(
        "INSERT OR REPLACE INTO event_dedup(msg_id) VALUES(%s)",
        "INSERT INTO event_dedup(msg_id) VALUES(%s) "
        "ON CONFLICT (msg_id) DO UPDATE SET consumed_at = NOW()")
    return s


class PgCursor:
    """psycopg2 cursor 包装：SQL 翻译 + lastrowid 语义。"""

    def __init__(self, cur):
        self._cur = cur
        self._returning_row = None

    def execute(self, sql, params=()):
        s = _translate_pg(sql)
        if params and not isinstance(params, (list, tuple)):
            params = (params,)
        self._cur.execute(s, params)
        self._returning_row = None
        if "RETURNING" in s.upper():
            # 立即消费 RETURNING 行并缓存；fetchone 幂等返回（commit 前必须消费，SQLite 语义）
            row = self._cur.fetchone()
            self._returning_row = row
        return self

    def fetchone(self):
        if self._returning_row is not None:
            row, self._returning_row = self._returning_row, None
            return row
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    @property
    def description(self):
        return self._cur.description

    def __getattr__(self, name):          # executemany 等透传
        return getattr(self._cur, name)


class PgConnection:
    """连接包装：cursor() 返回翻译游标；dict_row 统一行访问。"""

    def __init__(self, con):
        self._con = con

    def cursor(self):
        import psycopg2.extras
        return PgCursor(self._con.cursor(cursor_factory=psycopg2.extras.RealDictCursor))

    def commit(self):
        self._con.commit()

    def rollback(self):
        self._con.rollback()

    def close(self):
        self._con.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        if exc[0] is None:
            self._con.commit()
        else:
            self._con.rollback()
        return False

    def __getattr__(self, name):          # execute 等透传
        return getattr(self._con, name)


# ============ 统一入口 ============

def _sqlite_migrate(db_file):
    """SQLite 轻量迁移：Step3 双列 deadline_at + Step2 event_dedup 已在建表内。"""
    con = sqlite3.connect(db_file)
    c = con.cursor()
    c.execute("PRAGMA table_info(task)")
    cols = {r[1] for r in c.fetchall()}
    if "deadline_at" not in cols:
        c.execute("ALTER TABLE task ADD COLUMN deadline_at TEXT")
    con.commit()
    con.close()


def get_conn():
    """返回原生 sqlite3 连接或 PgConnection 包装（行均为 dict 可键访问）。"""
    if BACKEND == "postgres":
        return PgConnection(_pg_connect(DATABASE_URL))
    con = sqlite3.connect(SQLITE_FILE, timeout=15)  # busy timeout 15s：worker 线程与用例并发写的容忍度
    con.row_factory = sqlite3.Row
    return con


def init_db(db_file=None):
    """建表 + 种子。SQLite：原 1:1 逻辑 + 轻量迁移（deadline_at 补列）；PG：POSTGRES_SCHEMA。"""
    if BACKEND == "postgres":
        con = PgConnection(_pg_connect(db_file or DATABASE_URL))
        cur = con.cursor()
        for stmt in [st.strip() for st in POSTGRES_SCHEMA.split(";") if st.strip()]:
            cur.execute(stmt)
        # 迭代1 补齐：对已存在的旧库幂等补齐（CREATE IF NOT EXISTS 对已存在的表不生效）
        cur.execute("ALTER TABLE task ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ")
        # 迭代2 B3 补齐：旧 PG 库 term 表缺 source/created_at（实测 2026-08-30 UndefinedColumn）
        cur.execute("ALTER TABLE term ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'")
        cur.execute("ALTER TABLE term ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()")
        # add_term 的 ON CONFLICT(term) 依赖唯一约束；旧库无 → 去重后补唯一索引
        cur.execute("DELETE FROM term a USING term b WHERE a.id > b.id AND a.term = b.term")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS term_term_uidx ON term(term)")
        cur.execute("SELECT COUNT(*) AS n FROM person")
        if cur.fetchone()["n"] == 0:
            cur.executemany("INSERT INTO person(id, real_name, flower_name, title, group_id) "
                            "VALUES(%s,%s,%s,%s,%s)", SEED_PERSONS)
            cur.executemany("INSERT INTO alias(person_id, name) VALUES(%s,%s)", SEED_ALIASES)
        con.commit()
        con.close()
        return get_conn()

    # ---- SQLite 分支 ----
    con = sqlite3.connect(db_file or SQLITE_FILE)
    c = con.cursor()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS person(id INTEGER PRIMARY KEY, real_name TEXT, flower_name TEXT, title TEXT, group_id INTEGER);
    CREATE TABLE IF NOT EXISTS alias(person_id INTEGER, name TEXT);
    CREATE TABLE IF NOT EXISTS task(id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, creator TEXT,
                      assignee TEXT, deadline TEXT, deadline_at TEXT,
                      status TEXT, confidence TEXT, source_msg TEXT, pending_meta TEXT,
                      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);
    CREATE TABLE IF NOT EXISTS audit(actor TEXT, action TEXT, detail TEXT, ts TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS ai_dm(id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id TEXT, direction TEXT, content TEXT, task_id INTEGER, read_flag INTEGER DEFAULT 0, ts TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS message(id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT, sender_id TEXT, sender_name TEXT, content TEXT, content_type INTEGER DEFAULT 101, is_self INTEGER DEFAULT 0, msg_seq INTEGER, client_msg_id TEXT, ts TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS role(oim_user_id TEXT PRIMARY KEY, role TEXT DEFAULT 'member', updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS approval(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, detail TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), decided_at TEXT, decided_by TEXT);
    CREATE TABLE IF NOT EXISTS term(id INTEGER PRIMARY KEY AUTOINCREMENT, term TEXT NOT NULL UNIQUE, meaning TEXT NOT NULL, source TEXT DEFAULT 'manual', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS grp_meta(oim_group_id TEXT PRIMARY KEY, intro TEXT DEFAULT '', ai_enabled INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS event_dedup(msg_id TEXT PRIMARY KEY, consumed_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS reminder_sent(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, tier TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(task_id, tier));
    CREATE TABLE IF NOT EXISTS minutes(id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT, title TEXT, summary TEXT,
                      decisions TEXT, action_items TEXT, msg_count INTEGER DEFAULT 0,
                      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS mine_candidate(id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT, kind TEXT,
                         payload TEXT, evidence TEXT, msg_count INTEGER DEFAULT 0,
                         status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')),
                         decided_at TEXT, decided_by TEXT);
    """)
    c.execute("SELECT COUNT(*) FROM person")
    if c.fetchone()[0] == 0:
        c.executemany("INSERT INTO person VALUES(?,?,?,?,?)", SEED_PERSONS)
        c.executemany("INSERT INTO alias VALUES(?,?)", SEED_ALIASES)
    con.row_factory = sqlite3.Row
    con.commit()
    return con


def _pg_connect(url):
    import psycopg2
    import psycopg2.extras
    con = psycopg2.connect(url)
    # 会话时区固定东八：否则 deadline_at 这类无时区文本会被按 UTC 解释，
    # PG 模式下所有截止时间偏移 8 小时（提醒晚到/早到 8h，2026-08-28 修复）
    con.cursor().execute("SET TIME ZONE 'Asia/Shanghai'")
    con.commit()
    return con


def take_id(cursor):
    """INSERT ... RETURNING id 统一取值：须在 commit 前调用（消费一行）。"""
    row = cursor.fetchone()
    if row is None:
        return None
    return row["id"] if isinstance(row, dict) else row[0]


def _rows(cursor):
    """统一 dict 行提取：兼容 sqlite3.Row 与 psycopg2 RealDict 行。"""
    if cursor.description is None:
        return []
    cols = [d[0] for d in cursor.description]
    rows = cursor.fetchall()
    return [dict(r) if isinstance(r, dict) else dict(zip(cols, r)) for r in rows]
