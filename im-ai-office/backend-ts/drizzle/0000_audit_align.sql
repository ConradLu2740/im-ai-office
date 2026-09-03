-- 0001 audit schema 漂移对齐（生产 audit = created_at + JSONB；代码 schema = ts + TEXT → 统一到代码 schema）
-- 幂等：重跑安全；CI / 全新空库先补建表（代码 schema 口径），再执行对齐
CREATE TABLE IF NOT EXISTS audit (
	id bigserial PRIMARY KEY,
	actor text,
	action text,
	detail text,
	grp_id bigint,
	task_id bigint,
	created_at timestamptz DEFAULT now(),
	ts timestamptz
);
ALTER TABLE audit ADD COLUMN IF NOT EXISTS ts TIMESTAMPTZ;
-- 仅漂移库（存在 created_at 列）需要回填 ts
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit' AND column_name = 'created_at') THEN
		UPDATE audit SET ts = created_at WHERE ts IS NULL AND created_at IS NOT NULL AND ts IS DISTINCT FROM created_at;
	END IF;
END $$;
ALTER TABLE audit ALTER COLUMN detail TYPE TEXT USING detail::text;
