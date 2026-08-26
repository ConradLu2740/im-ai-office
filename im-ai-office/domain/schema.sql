-- 对话式 AI 办公 · MVP schema
-- 幂等可重跑：IF NOT EXISTS

CREATE TABLE IF NOT EXISTS person (
  id          BIGSERIAL PRIMARY KEY,
  oim_user_id TEXT UNIQUE,
  real_name   TEXT,
  flower_name TEXT,
  title       TEXT,
  group_id    BIGINT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alias (
  id         BIGSERIAL PRIMARY KEY,
  person_id  BIGINT REFERENCES person(id),
  name       TEXT,
  source     TEXT DEFAULT 'registered',  -- registered | mined
  UNIQUE(person_id, name)
);
CREATE INDEX IF NOT EXISTS idx_alias_name ON alias(name);

CREATE TABLE IF NOT EXISTS grp (
  id          BIGSERIAL PRIMARY KEY,
  oim_group_id TEXT UNIQUE,
  name        TEXT,
  intro       TEXT,
  ai_enabled  BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task (
  id           BIGSERIAL PRIMARY KEY,
  grp_id       BIGINT REFERENCES grp(id),
  content      TEXT,
  creator      TEXT,   -- MVP 存显示名（正式可改回 creator_id 外键）
  assignee     TEXT,   -- MVP 存显示名（正式可改回 assignee_id 外键）
  deadline     TEXT,
  status       TEXT DEFAULT 'pending_confirmation',
  confidence   TEXT,
  source_msg   TEXT,
  ai_fact      JSONB,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
-- 防重复：同一群 + 同一来源消息 只建一个任务
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_grp_msg ON task(grp_id, source_msg);

CREATE TABLE IF NOT EXISTS term (
  id         BIGSERIAL PRIMARY KEY,
  grp_id     BIGINT REFERENCES grp(id),
  term       TEXT,
  meaning    TEXT,
  creator_id BIGINT REFERENCES person(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT,
  action     TEXT,
  detail     JSONB,
  grp_id     BIGINT,
  task_id    BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_dedup (
  msg_id      TEXT PRIMARY KEY,
  consumed_at TIMESTAMPTZ DEFAULT now()
);
