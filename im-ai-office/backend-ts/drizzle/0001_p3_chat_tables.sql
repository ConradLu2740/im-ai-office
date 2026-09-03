CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "app_user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "group_member" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "pk_group_member" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_group" (
	"group_id" text PRIMARY KEY NOT NULL,
	"name" text
);
--> statement-breakpoint
CREATE TABLE "user_last_read" (
	"user_id" text NOT NULL,
	"conv_id" text NOT NULL,
	"last_msg_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "pk_user_last_read" PRIMARY KEY("user_id","conv_id")
);
--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- message 唯一索引已移入 0002_p0_baseline_tables（message 表由 0002 建表，索引不能先于表存在）