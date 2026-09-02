import { pgTable, bigserial, text, integer, timestamp, unique, boolean, index, foreignKey, bigint, uniqueIndex, jsonb, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const aiDm = pgTable("ai_dm", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	senderId: text("sender_id"),
	direction: text(),
	content: text(),
	taskId: integer("task_id"),
	readFlag: integer("read_flag").default(0),
	ts: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
});

export const grp = pgTable("grp", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	oimGroupId: text("oim_group_id"),
	name: text(),
	intro: text(),
	aiEnabled: boolean("ai_enabled").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("grp_oim_group_id_key").on(table.oimGroupId),
]);

export const approval = pgTable("approval", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	actor: text(),
	action: text(),
	detail: text(),
	status: text().default('pending'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'string' }),
	decidedBy: text("decided_by"),
});

export const digestSent = pgTable("digest_sent", {
	digestDate: text("digest_date").primaryKey().notNull(),
	count: integer(),
	pushedAt: timestamp("pushed_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const eventDedup = pgTable("event_dedup", {
	msgId: text("msg_id").primaryKey().notNull(),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const grpMeta = pgTable("grp_meta", {
	oimGroupId: text("oim_group_id").primaryKey().notNull(),
	intro: text().default(''),
	aiEnabled: integer("ai_enabled").default(1),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const message = pgTable("message", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	convId: text("conv_id"),
	senderId: text("sender_id"),
	senderName: text("sender_name"),
	content: text(),
	contentType: integer("content_type").default(101),
	isSelf: integer("is_self").default(0),
	msgSeq: integer("msg_seq"),
	clientMsgId: text("client_msg_id"),
	ts: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	// 评审 D2：并发去重最终防线（check-then-insert 历史踩坑根因模式）；NULL 不受约束
	uniqueIndex("uq_message_conv_client_msg").on(table.convId, table.clientMsgId),
]);

// ============ P3 自建聊天层（Spec §4.1；id 复用 OpenIM userID，禁另起新 id 体系） ============

export const appUser = pgTable("app_user", {
	// 直接复用 OpenIM userID（如 user001）：历史 message.sender_id/task.creator/ai_dm.sender_id/role.oim_user_id 天然对齐
	id: text().primaryKey().notNull(),
	username: text().notNull().unique(),
	displayName: text("display_name"),
	passwordHash: text("password_hash").notNull(),
	role: text().default("member").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow(),
});

export const session = pgTable("session", {
	// 随机 32B hex token
	token: text().primaryKey().notNull(),
	userId: text("user_id").notNull().references(() => appUser.id),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const userGroup = pgTable("user_group", {
	groupId: text("group_id").primaryKey().notNull(),
	name: text(),
});

export const groupMember = pgTable("group_member", {
	groupId: text("group_id").notNull(),
	userId: text("user_id").notNull().references(() => appUser.id),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: "string" }).defaultNow(),
}, (table) => [
	primaryKey({ columns: [table.groupId, table.userId], name: "pk_group_member" }),
]);

export const userLastRead = pgTable("user_last_read", {
	userId: text("user_id").notNull(),
	convId: text("conv_id").notNull(),
	lastMsgId: bigint("last_msg_id", { mode: "number" }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow(),
}, (table) => [
	primaryKey({ columns: [table.userId, table.convId], name: "pk_user_last_read" }),
]);

export const mineCandidate = pgTable("mine_candidate", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	convId: text("conv_id"),
	kind: text(),
	payload: text(),
	evidence: text(),
	msgCount: integer("msg_count").default(0),
	status: text().default('pending'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'string' }),
	decidedBy: text("decided_by"),
});

export const minutes = pgTable("minutes", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	convId: text("conv_id"),
	title: text(),
	summary: text(),
	decisions: text(),
	actionItems: text("action_items"),
	msgCount: integer("msg_count").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const alias = pgTable("alias", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	personId: bigint("person_id", { mode: "number" }),
	name: text(),
	source: text().default('registered'),
}, (table) => [
	index("idx_alias_name").using("btree", table.name.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.personId],
			foreignColumns: [person.id],
			name: "alias_person_id_fkey"
		}),
	unique("alias_person_id_name_key").on(table.personId, table.name),
]);

export const reminderSent = pgTable("reminder_sent", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	taskId: bigint("task_id", { mode: "number" }),
	tier: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("reminder_sent_task_id_tier_key").on(table.taskId, table.tier),
]);

export const role = pgTable("role", {
	oimUserId: text("oim_user_id").primaryKey().notNull(),
	role: text().default('member'),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const person = pgTable("person", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	oimUserId: text("oim_user_id"),
	realName: text("real_name"),
	flowerName: text("flower_name"),
	title: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	groupId: bigint("group_id", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("person_oim_user_id_key").on(table.oimUserId),
]);

export const task = pgTable("task", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	grpId: bigint("grp_id", { mode: "number" }),
	content: text(),
	creator: text(),
	assignee: text(),
	deadline: text(),
	status: text().default('pending_confirmation'),
	confidence: text(),
	sourceMsg: text("source_msg"),
	aiFact: jsonb("ai_fact"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deadlineAt: timestamp("deadline_at", { withTimezone: true, mode: 'string' }),
	pendingMeta: text("pending_meta"),
}, (table) => [
	uniqueIndex("uq_task_grp_msg").using("btree", table.grpId.asc().nullsLast().op("int8_ops"), table.sourceMsg.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.grpId],
			foreignColumns: [grp.id],
			name: "task_grp_id_fkey"
		}),
]);

export const term = pgTable("term", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	grpId: bigint("grp_id", { mode: "number" }),
	term: text(),
	meaning: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	creatorId: bigint("creator_id", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	source: text().default('manual'),
}, (table) => [
	uniqueIndex("term_term_uidx").using("btree", table.term.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.creatorId],
			foreignColumns: [person.id],
			name: "term_creator_id_fkey"
		}),
	foreignKey({
			columns: [table.grpId],
			foreignColumns: [grp.id],
			name: "term_grp_id_fkey"
		}),
]);

export const audit = pgTable("audit", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	actor: text(),
	action: text(),
	detail: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	grpId: bigint("grp_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	taskId: bigint("task_id", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	ts: timestamp({ withTimezone: true, mode: 'string' }),
});
