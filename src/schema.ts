import {
	type InferInsertModel,
	type InferSelectModel,
	relations,
} from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgTable,
	pgPolicy,
	pgRole,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

export type UserRole = 'authenticated' | 'member' | 'admin';

export const publicRole = pgRole('public').existing(); // For unauthenticated access
export const authenticatedRole = pgRole('authenticated'); // For any logged-in user
export const memberRole = pgRole('member', { inherit: true }); // For verified members
export const adminRole = pgRole('admin', { createRole: false }); // For administrators

// Note: 'public' is a built-in PostgreSQL role for unauthenticated access
// 'authenticated' is for any logged-in user (default role)
// 'member' is for verified/paying users
// 'admin' is for users with administrative privileges

export const users = pgTable("users", {
	id: uuid("id").primaryKey().defaultRandom(),
	role: text("role").notNull().default('authenticated').$type<UserRole>(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
	index("users_role_idx").on(table.role),
	pgPolicy("users_select_authenticated", {
		as: "permissive",
		to: authenticatedRole,
		for: "select",
		using: sql`id = current_setting('app.current_user_id', true)::uuid`,
	}),
	pgPolicy("users_select_members", {
		as: "permissive",
		to: memberRole,
		for: "select",
		using: sql`true`, // Members can see all users
	}),
	pgPolicy("users_select_admin", {
		as: "permissive",
		to: adminRole,
		for: "select",
		using: sql`true`, // Admins can see all users
	}),
	pgPolicy("users_update_self", {
		as: "permissive",
		to: authenticatedRole,
		for: "update",
		using: sql`id = current_setting('app.current_user_id', true)::uuid`,
		withCheck: sql`id = current_setting('app.current_user_id', true)::uuid`,
	}),
	pgPolicy("users_update_admin", {
		as: "permissive",
		to: adminRole,
		for: "update",
		using: sql`true`,
		withCheck: sql`true`,
	}),
	pgPolicy("users_delete_admin", {
		as: "permissive",
		to: adminRole,
		for: "delete",
		using: sql`true`,
	}),
]).enableRLS();

export const usersRelations = relations(users, ({ many }) => ({
	identities: many(userIdentities),
	practiceSessions: many(practiceSessions),
	apiKeys: many(apiKeys),
	projects: many(projects),
	refreshTokens: many(refreshTokens),
}));

export const userIdentities = pgTable(
	"user_identities",
	{
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		platform: text("platform").notNull(), // 'discord', 'evm', 'lens', 'farcaster', 'telegram'
		identity: text("identity").notNull(),
		isPrimary: boolean("is_primary").default(false).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.platform, table.identity] }),
		index("user_identities_user_id_idx").on(table.userId),
		index("user_identities_primary_idx")
			.on(table.userId, table.isPrimary)
			.where(sql`${table.isPrimary} = true`),
		pgPolicy("user_identities_select_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "select",
			using: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
		}),
		pgPolicy("user_identities_select_admin", {
			as: "permissive",
			to: adminRole,
			for: "select",
			using: sql`true`,
		}),
		pgPolicy("user_identities_insert_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "insert",
			withCheck: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
		}),
		pgPolicy("user_identities_insert_admin", {
			as: "permissive",
			to: adminRole,
			for: "insert",
			withCheck: sql`true`,
		}),
		pgPolicy("user_identities_update_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "update",
			using: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
			withCheck: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
		}),
		pgPolicy("user_identities_update_admin", {
			as: "permissive",
			to: adminRole,
			for: "update",
			using: sql`true`,
			withCheck: sql`true`,
		}),
		pgPolicy("user_identities_delete_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "delete",
			using: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
		}),
		pgPolicy("user_identities_delete_admin", {
			as: "permissive",
			to: adminRole,
			for: "delete",
			using: sql`true`,
		}),
	],
).enableRLS();

export const userIdentitiesRelations = relations(userIdentities, ({ one }) => ({
	user: one(users, {
		fields: [userIdentities.userId],
		references: [users.id],
	}),
}));

export const vanishingChannels = pgTable(
	"vanishing_channels",
	{
		channelId: text("channel_id").primaryKey(),
		guildId: text("guild_id").notNull(),
		vanishAfter: integer("vanish_after").notNull(), // duration in seconds
		messagesDeleted: integer("messages_deleted").default(0),
		lastDeletion: timestamp("last_deletion", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("vanishing_channels_guild_idx").on(table.guildId),
		pgPolicy("vanishing_channels_admin_all", {
			as: "permissive",
			to: adminRole,
			for: "all",
			using: sql`true`,
			withCheck: sql`true`,
		}),
	],
).enableRLS();

export const practiceSessions = pgTable(
	"practice_sessions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		startTime: timestamp("start_time", { withTimezone: true }).notNull(),
		endTime: timestamp("end_time", { withTimezone: true }),
		duration: integer("duration"), // duration in seconds
		date: text("date").notNull(), // Using text to store YYYY-MM-DD format
		notes: text("notes"),
	},
	(table) => [
		index("practice_sessions_user_date_idx").on(table.userId, table.date),
		index("practice_sessions_active_idx")
			.on(table.userId)
			.where(sql`${table.endTime} IS NULL`),
		pgPolicy("practice_sessions_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "all",
			using: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
			withCheck: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
		}),
		pgPolicy("practice_sessions_admin", {
			as: "permissive",
			to: adminRole,
			for: "all",
			using: sql`true`,
			withCheck: sql`true`,
		}),
	],
).enableRLS();

export const practiceSessionsRelations = relations(
	practiceSessions,
	({ one }) => ({
		user: one(users, {
			fields: [practiceSessions.userId],
			references: [users.id],
		}),
	}),
);

export const channelSettings = pgTable(
	"channel_settings",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		guildId: text("guild_id").notNull(),
		key: text("key").notNull(), // e.g., 'voice', 'text', 'alerts', etc.
		channelId: text("channel_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("channel_settings_guild_key_idx").on(table.guildId, table.key),
		pgPolicy("channel_settings_admin_all", {
			as: "permissive",
			to: adminRole,
			for: "all",
			using: sql`true`,
			withCheck: sql`true`,
		}),
	],
).enableRLS();

export interface User extends InferSelectModel<typeof users> {
	role: UserRole;
}
export interface NewUser extends InferInsertModel<typeof users> {}

export interface UserIdentity extends InferSelectModel<typeof userIdentities> {}
export interface NewUserIdentity
	extends InferInsertModel<typeof userIdentities> {}

export interface VanishingChannel
	extends InferSelectModel<typeof vanishingChannels> {
	messagesDeleted: number;
	lastDeletion: Date | null;
}
export interface NewVanishingChannel
	extends InferInsertModel<typeof vanishingChannels> {}

export interface PracticeSession
	extends InferSelectModel<typeof practiceSessions> {
	endTime: Date | null;
	duration: number | null;
	notes: string | null;
}
export interface NewPracticeSession
	extends InferInsertModel<typeof practiceSessions> {}

export interface ChannelSetting
	extends InferSelectModel<typeof channelSettings> {}
export interface NewChannelSetting
	extends InferInsertModel<typeof channelSettings> {}

export const applications = pgTable(
	"applications",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationNumber: integer("application_number").notNull().unique(),
		messageId: text("message_id").notNull().unique(),
		walletAddress: text("wallet_address").notNull(),
		ensName: text("ens_name"),
		github: text("github"),
		farcaster: text("farcaster"),
		lens: text("lens"),
		twitter: text("twitter"),
		excitement: text("excitement").notNull(),
		motivation: text("motivation").notNull(),
		signature: text("signature").notNull(),
		status: text("status").default("pending"),
		submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow(),
		decidedAt: timestamp("decided_at", { withTimezone: true }),
	},
	(table) => [
		index("applications_status_idx").on(table.status),
		index("applications_wallet_idx").on(table.walletAddress),
		pgPolicy("applications_select_member", {
			as: "permissive",
			to: memberRole,
			for: "select",
			using: sql`true`,
		}),
		pgPolicy("applications_admin_all", {
			as: "permissive",
			to: adminRole,
			for: "all",
			using: sql`true`,
			withCheck: sql`true`,
		}),
	],
).enableRLS();

export const applicationVotes = pgTable(
	"application_votes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => applications.id, { onDelete: "cascade" }),
		userId: text("user_id").notNull(),
		userName: text("user_name"),
		voteType: text("vote_type").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.applicationId, table.userId] }),
		index("votes_application_idx").on(table.applicationId),
		pgPolicy("application_votes_member", {
			as: "permissive",
			to: memberRole,
			for: "all",
			using: sql`true`,
			withCheck: sql`true`,
		}),
		pgPolicy("application_votes_admin", {
			as: "permissive",
			to: adminRole,
			for: "all",
			using: sql`true`,
			withCheck: sql`true`,
		}),
	],
).enableRLS();

export const applicationsRelations = relations(applications, ({ many }) => ({
	votes: many(applicationVotes),
}));

export const applicationVotesRelations = relations(
	applicationVotes,
	({ one }) => ({
		application: one(applications, {
			fields: [applicationVotes.applicationId],
			references: [applications.id],
		}),
	}),
);

export interface Application extends InferSelectModel<typeof applications> {}
export interface NewApplication extends InferInsertModel<typeof applications> {}
export interface ApplicationVote
	extends InferSelectModel<typeof applicationVotes> {}
export interface NewApplicationVote
	extends InferInsertModel<typeof applicationVotes> {}

export const apiKeys = pgTable(
	"api_keys",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		keyPrefix: text("key_prefix").notNull().unique(), // First 8 chars for identification
		keyHash: text("key_hash").notNull().unique(), // SHA-256 hash of full key
		description: text("description"),
		clientName: text("client_name"), // Name of the client application
		allowedOrigins: text("allowed_origins").array(), // Allowed domains/URIs for SIWE
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("api_keys_user_id_idx").on(table.userId),
		index("api_keys_prefix_idx")
			.on(table.keyPrefix)
			.where(sql`${table.isActive} = true`),
		index("api_keys_expires_idx")
			.on(table.expiresAt)
			.where(sql`${table.isActive} = true`),
		pgPolicy("api_keys_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "all",
			using: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
			withCheck: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
		}),
		pgPolicy("api_keys_admin", {
			as: "permissive",
			to: adminRole,
			for: "all",
			using: sql`true`,
			withCheck: sql`true`,
		}),
	],
).enableRLS();

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
	user: one(users, {
		fields: [apiKeys.userId],
		references: [users.id],
	}),
}));

export interface ApiKey extends InferSelectModel<typeof apiKeys> {}
export interface NewApiKey extends InferInsertModel<typeof apiKeys> {}

export const refreshTokens = pgTable(
	"refresh_tokens",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull().unique(),
		familyId: uuid("family_id").notNull(), // For refresh token rotation detection
		clientId: text("client_id"), // API key ID that created this token
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		usedAt: timestamp("used_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("refresh_tokens_user_id_idx").on(table.userId),
		index("refresh_tokens_hash_idx").on(table.tokenHash),
		index("refresh_tokens_family_idx").on(table.familyId),
		index("refresh_tokens_expires_idx").on(table.expiresAt),
		pgPolicy("refresh_tokens_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "all",
			using: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
			withCheck: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
		}),
		pgPolicy("refresh_tokens_admin", {
			as: "permissive",
			to: adminRole,
			for: "all",
			using: sql`true`,
			withCheck: sql`true`,
		}),
	],
).enableRLS();

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
	user: one(users, {
		fields: [refreshTokens.userId],
		references: [users.id],
	}),
}));

export interface RefreshToken extends InferSelectModel<typeof refreshTokens> {}
export interface NewRefreshToken extends InferInsertModel<typeof refreshTokens> {}

export const projects = pgTable(
	"projects",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		description: text("description").notNull(),
		githubUrl: text("github_url"),
		deploymentUrl: text("deployment_url"),
		tags: text("tags").array().default(sql`ARRAY[]::text[]`),
		isPublic: boolean("is_public").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("projects_user_id_idx").on(table.userId),
		index("projects_public_idx")
			.on(table.isPublic)
			.where(sql`${table.isPublic} = true`),
		index("projects_tags_idx").using("gin", table.tags),
		// Public can see public projects
		pgPolicy("projects_select_public", {
			as: "permissive",
			to: publicRole,
			for: "select",
			using: sql`is_public = true`,
		}),
		// Authenticated users can see their own projects + public ones
		pgPolicy("projects_select_authenticated", {
			as: "permissive",
			to: authenticatedRole,
			for: "select",
			using: sql`is_public = true OR user_id = current_setting('app.current_user_id', true)::uuid`,
		}),
		// Members can see all projects
		pgPolicy("projects_select_member", {
			as: "permissive",
			to: memberRole,
			for: "select",
			using: sql`true`,
		}),
		// Admins can see all projects
		pgPolicy("projects_select_admin", {
			as: "permissive",
			to: adminRole,
			for: "select",
			using: sql`true`,
		}),
		// Authenticated users can create their own projects
		pgPolicy("projects_insert_authenticated", {
			as: "permissive",
			to: authenticatedRole,
			for: "insert",
			withCheck: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
		}),
		// Users can update their own projects
		pgPolicy("projects_update_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "update",
			using: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
			withCheck: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
		}),
		// Admins can update any project
		pgPolicy("projects_update_admin", {
			as: "permissive",
			to: adminRole,
			for: "update",
			using: sql`true`,
			withCheck: sql`true`,
		}),
		// Users can delete their own projects
		pgPolicy("projects_delete_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "delete",
			using: sql`user_id = current_setting('app.current_user_id', true)::uuid`,
		}),
		// Admins can delete any project
		pgPolicy("projects_delete_admin", {
			as: "permissive",
			to: adminRole,
			for: "delete",
			using: sql`true`,
		}),
	],
).enableRLS();

export const projectsRelations = relations(projects, ({ one }) => ({
	user: one(users, {
		fields: [projects.userId],
		references: [users.id],
	}),
}));

export interface Project extends InferSelectModel<typeof projects> {
	tags: string[];
}
export interface NewProject extends InferInsertModel<typeof projects> {}
