-- 0002 空库引导基线：补齐历史迁移未覆盖的全部业务表（对齐 schema.ts / 生产 imai 库真实 DDL）
-- 幂等：全新库全量建表；生产库重放全部 no-op（CREATE TABLE IF NOT EXISTS + 约束存在性守卫）
-- 注：person/task/term 等表此前仅存在于生产库漂移态，任何全新部署（含 CI）都靠本迁移引导

CREATE TABLE IF NOT EXISTS "grp" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"oim_group_id" text,
	"name" text,
	"intro" text,
	"ai_enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "grp_oim_group_id_key" ON "grp" USING btree ("oim_group_id");

CREATE TABLE IF NOT EXISTS "person" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"oim_user_id" text,
	"real_name" text,
	"flower_name" text,
	"title" text,
	"group_id" bigint,
	"created_at" timestamp with time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "person_oim_user_id_key" ON "person" USING btree ("oim_user_id");

CREATE TABLE IF NOT EXISTS "alias" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"person_id" bigint,
	"name" text,
	"source" text DEFAULT 'registered'
);
CREATE UNIQUE INDEX IF NOT EXISTS "alias_pkey" ON "alias" USING btree ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "alias_person_id_name_key" ON "alias" USING btree ("person_id","name");
CREATE INDEX IF NOT EXISTS "idx_alias_name" ON "alias" USING btree ("name");

CREATE TABLE IF NOT EXISTS "task" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"grp_id" bigint,
	"content" text,
	"creator" text,
	"assignee" text,
	"deadline" text,
	"status" text DEFAULT 'pending_confirmation',
	"confidence" text,
	"source_msg" text,
	"ai_fact" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deadline_at" timestamp with time zone,
	"pending_meta" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_task_grp_msg" ON "task" USING btree ("grp_id","source_msg");

CREATE TABLE IF NOT EXISTS "message" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conv_id" text,
	"sender_id" text,
	"sender_name" text,
	"content" text,
	"content_type" integer DEFAULT 101,
	"is_self" integer DEFAULT 0,
	"msg_seq" integer,
	"client_msg_id" text,
	"ts" timestamp with time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_message_conv_client_msg" ON "message" USING btree ("conv_id","client_msg_id");

CREATE TABLE IF NOT EXISTS "ai_dm" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sender_id" text,
	"direction" text,
	"content" text,
	"task_id" integer,
	"read_flag" integer DEFAULT 0,
	"ts" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "role" (
	"oim_user_id" text PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'member',
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "approval" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text,
	"action" text,
	"detail" text,
	"status" text DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now(),
	"decided_at" timestamp with time zone,
	"decided_by" text
);

CREATE TABLE IF NOT EXISTS "term" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"grp_id" bigint,
	"term" text,
	"meaning" text,
	"creator_id" bigint,
	"created_at" timestamp with time zone DEFAULT now(),
	"source" text DEFAULT 'manual'
);
CREATE UNIQUE INDEX IF NOT EXISTS "term_term_uidx" ON "term" USING btree ("term");

CREATE TABLE IF NOT EXISTS "grp_meta" (
	"oim_group_id" text PRIMARY KEY NOT NULL,
	"intro" text DEFAULT '',
	"ai_enabled" integer DEFAULT 1,
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "reminder_sent" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"task_id" bigint,
	"tier" text,
	"created_at" timestamp with time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_sent_task_id_tier_key" ON "reminder_sent" USING btree ("task_id","tier");

CREATE TABLE IF NOT EXISTS "digest_sent" (
	"digest_date" text PRIMARY KEY NOT NULL,
	"count" integer,
	"pushed_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "event_dedup" (
	"msg_id" text PRIMARY KEY NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "mine_candidate" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conv_id" text,
	"kind" text,
	"payload" text,
	"evidence" text,
	"msg_count" integer DEFAULT 0,
	"status" text DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now(),
	"decided_at" timestamp with time zone,
	"decided_by" text
);

CREATE TABLE IF NOT EXISTS "minutes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conv_id" text,
	"title" text,
	"summary" text,
	"decisions" text,
	"action_items" text,
	"msg_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now()
);

--> statement-breakpoint
-- 外键（存在性守卫，生产重放 no-op）
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alias_person_id_fkey') THEN
		ALTER TABLE "alias" ADD CONSTRAINT "alias_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_grp_id_fkey') THEN
		ALTER TABLE "task" ADD CONSTRAINT "task_grp_id_fkey" FOREIGN KEY ("grp_id") REFERENCES "grp"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'term_grp_id_fkey') THEN
		ALTER TABLE "term" ADD CONSTRAINT "term_grp_id_fkey" FOREIGN KEY ("grp_id") REFERENCES "grp"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'term_creator_id_fkey') THEN
		ALTER TABLE "term" ADD CONSTRAINT "term_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "person"("id");
	END IF;
END $$;
