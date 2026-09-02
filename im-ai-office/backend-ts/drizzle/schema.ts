import { pgTable, bigserial, text, integer, timestamp, unique, boolean, index, foreignKey, bigint, uniqueIndex, jsonb } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const aiDm = pgTable("ai_dm", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	senderId: text("sender_id"),
	direction: text(),
	content: text(),
	taskId: integer("task_id"),
	readFlag: integer("read_flag").default(0),
	ts: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
});

export const grp = pgTable("grp", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	oimGroupId: text("oim_group_id"),
	name: text(),
	intro: text(),
	aiEnabled: boolean("ai_enabled").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("grp_oim_group_id_key").on(table.oimGroupId),
]);

export const approval = pgTable("approval", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
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
	intro: text().default('),
	aiEnabled: integer("ai_enabled").default(1),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const message = pgTable("message", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	convId: text("conv_id"),
	senderId: text("sender_id"),
	senderName: text("sender_name"),
	content: text(),
	contentType: integer("content_type").default(101),
	isSelf: integer("is_self").default(0),
	msgSeq: integer("msg_seq"),
	clientMsgId: text("client_msg_id"),
	ts: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
});

export const mineCandidate = pgTable("mine_candidate", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
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
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	convId: text("conv_id"),
	title: text(),
	summary: text(),
	decisions: text(),
	actionItems: text("action_items"),
	msgCount: integer("msg_count").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const alias = pgTable("alias", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
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
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
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
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
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
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
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
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
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
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
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
