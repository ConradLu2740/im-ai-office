-- 0001 audit schema 漂移对齐（生产 audit = created_at + JSONB；代码 schema = ts + TEXT → 统一到代码 schema）
-- 幂等：重跑安全（重跑时 UPDATE 零行、ALTER 对已是 TEXT 的列为 no-op）
ALTER TABLE audit ADD COLUMN IF NOT EXISTS ts TIMESTAMPTZ;
UPDATE audit SET ts = created_at WHERE ts IS NULL AND created_at IS NOT NULL AND ts IS DISTINCT FROM created_at;
ALTER TABLE audit ALTER COLUMN detail TYPE TEXT USING detail::text;
