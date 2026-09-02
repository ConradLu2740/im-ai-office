import { relations } from "drizzle-orm/relations";
import { person, alias, grp, task, term } from "./schema";

export const aliasRelations = relations(alias, ({one}) => ({
	person: one(person, {
		fields: [alias.personId],
		references: [person.id]
	}),
}));

export const personRelations = relations(person, ({many}) => ({
	aliases: many(alias),
	terms: many(term),
}));

export const taskRelations = relations(task, ({one}) => ({
	grp: one(grp, {
		fields: [task.grpId],
		references: [grp.id]
	}),
}));

export const grpRelations = relations(grp, ({many}) => ({
	tasks: many(task),
	terms: many(term),
}));

export const termRelations = relations(term, ({one}) => ({
	person: one(person, {
		fields: [term.creatorId],
		references: [person.id]
	}),
	grp: one(grp, {
		fields: [term.grpId],
		references: [grp.id]
	}),
}));