#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SQLite 连接与建表（自 core.py 数据层 1:1 迁移，表结构与种子逐字保留）"""
import sqlite3

from imai.config import DB_FILE


def init_db(db_file=None):
    """建库建表并补种子（person 为空时写入演示团队：两个小张消歧场景）。"""
    con = sqlite3.connect(db_file or DB_FILE)
    c = con.cursor()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS person(id INTEGER PRIMARY KEY, real_name TEXT, flower_name TEXT, title TEXT, group_id INTEGER);
    CREATE TABLE IF NOT EXISTS alias(person_id INTEGER, name TEXT);
    CREATE TABLE IF NOT EXISTS task(id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, creator TEXT,
                      assignee TEXT, deadline TEXT, status TEXT, confidence TEXT, source_msg TEXT,
                      pending_meta TEXT,
                      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);
    CREATE TABLE IF NOT EXISTS audit(actor TEXT, action TEXT, detail TEXT, ts TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS ai_dm(id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id TEXT, direction TEXT, content TEXT, task_id INTEGER, read_flag INTEGER DEFAULT 0, ts TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS message(id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT, sender_id TEXT, sender_name TEXT, content TEXT, content_type INTEGER DEFAULT 101, is_self INTEGER DEFAULT 0, msg_seq INTEGER, client_msg_id TEXT, ts TEXT DEFAULT (datetime('now')));
    -- M3 RBAC: 角色表
    CREATE TABLE IF NOT EXISTS role(oim_user_id TEXT PRIMARY KEY, role TEXT DEFAULT 'member', updated_at TEXT DEFAULT (datetime('now')));
    -- M3 RBAC: 高风险动作审批表
    CREATE TABLE IF NOT EXISTS approval(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, detail TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), decided_at TEXT, decided_by TEXT);
    -- M4 团队记忆: 术语表
    CREATE TABLE IF NOT EXISTS term(id INTEGER PRIMARY KEY AUTOINCREMENT, term TEXT NOT NULL UNIQUE, meaning TEXT NOT NULL, source TEXT DEFAULT 'manual', created_at TEXT DEFAULT (datetime('now')));
    -- M4 团队记忆: 群简介/旁听开关
    CREATE TABLE IF NOT EXISTS grp_meta(oim_group_id TEXT PRIMARY KEY, intro TEXT DEFAULT '', ai_enabled INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now')));
    """)
    # 种子人 + 别名（制造「两个小张」消歧场景），仅当为空
    c.execute("SELECT COUNT(*) FROM person")
    if c.fetchone()[0] == 0:
        c.executemany("INSERT INTO person VALUES(?,?,?,?,?)", [
            (1, "张伟", "小张", "产品经理", 100),
            (2, "张敏", "小张", "市场专员", 100),
            (3, "李娜", "娜姐", "运营", 100),
        ])
        c.executemany("INSERT INTO alias VALUES(?,?)", [(1, "小张"), (1, "张伟"), (2, "小张"), (2, "张敏"), (3, "娜姐")])
    con.row_factory = sqlite3.Row  # 统一 Row 访问，dict(row) 可用
    con.commit()
    return con


def get_conn(db_file=None):
    con = sqlite3.connect(db_file or DB_FILE)
    con.row_factory = sqlite3.Row
    return con


def _rows(cursor):
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, r)) for r in cursor.fetchall()]
