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
	json,
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
	address: text("address"), 
	ensName: text("ens_name"),
	ensAvatar: text("ens_avatar"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
	index("users_role_idx").on(table.role),
	index("users_address_idx").on(table.address),
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
	projects: many(projects),
	refreshTokens: many(refreshTokens),
}));

export const userIdentities = pgTable(
	"user_identities",
	{
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		platform: text("platform").notNull(), // 'discord', 'evm', 'lens', 'farcaster', 'telegram', 'github'
		identity: text("identity").notNull(),
		isPrimary: boolean("is_primary").default(false).notNull(),
		metadata: json("metadata").$type<{
			username?: string;
			displayName?: string;
			avatarUrl?: string;
			email?: string;
			bio?: string;
			profileUrl?: string;
		}>(), 
		verifiedAt: timestamp("verified_at", { withTimezone: true }), 
		oauthAccessToken: text("oauth_access_token"), 
		oauthRefreshToken: text("oauth_refresh_token"), 
		oauthTokenExpiresAt: timestamp("oauth_token_expires_at", { withTimezone: true }), 
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
		index("api_keys_prefix_idx")
			.on(table.keyPrefix)
			.where(sql`${table.isActive} = true`),
		index("api_keys_expires_idx")
			.on(table.expiresAt)
			.where(sql`${table.isActive} = true`),
		pgPolicy("api_keys_admin", {
			as: "permissive",
			to: adminRole,
			for: "all",
			using: sql`true`,
			withCheck: sql`true`,
		}),
	],
).enableRLS();

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({}));

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
		clientName: text("client_name"), // Name of the client application that created this token
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

export const projectsRelations = relations(projects, ({ one, many }) => ({
	user: one(users, {
		fields: [projects.userId],
		references: [users.id],
	}),
	projectTreasuries: many(projectTreasuries),
}));

export interface Project extends InferSelectModel<typeof projects> {
	tags: string[];
}
export interface NewProject extends InferInsertModel<typeof projects> {}

export const logs = pgTable(
	"logs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		
		timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
		level: text("level").notNull().$type<'info' | 'warn' | 'error' | 'fatal'>(),
		message: text("message").notNull(),
		data: json("data"), // JSON for structured information
		
		route: text("route"), // e.g., "GET /api/users"
		method: text("method"), // HTTP method
		path: text("path"), // URL path
		statusCode: integer("status_code"), // HTTP status
		duration: integer("duration"), // Request duration in ms
		
		userId: uuid("user_id").references(() => users.id),
		userRole: text("user_role").$type<UserRole>(),
		clientIp: text("client_ip"),
		userAgent: text("user_agent"),
		sessionId: text("session_id"),
		
		environment: text("environment"), // production, staging, dev
		version: text("version"), // API version
		service: text("service").default("cartel-api"),
		
		errorName: text("error_name"),
		errorStack: text("error_stack"),
		
		tags: text("tags").array().default(sql`ARRAY[]::text[]`), // For custom categorization
		category: text("category"), // database, auth, request, etc.
		operation: text("operation"), // create, read, update, delete, etc.
		
		traceId: text("trace_id"), // For distributed tracing
		correlationId: text("correlation_id"), // For request correlation
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		// Performance indexes for fast querying
		index("logs_timestamp_idx").on(table.timestamp),
		index("logs_level_timestamp_idx").on(table.level, table.timestamp),
		index("logs_user_timestamp_idx").on(table.userId, table.timestamp),
		index("logs_route_timestamp_idx").on(table.route, table.timestamp),
		index("logs_category_timestamp_idx").on(table.category, table.timestamp),
		
		// Search indexes
		index("logs_message_search_idx").on(table.message),
		index("logs_error_name_idx").on(table.errorName),
		index("logs_tags_idx").using("gin", table.tags),
		
		// RLS policies - only admin users can access logs
		pgPolicy("logs_admin_all", {
			as: "permissive",
			to: adminRole,
			for: "all",
			using: sql`true`,
			withCheck: sql`true`,
		}),
	],
).enableRLS();

export const logsRelations = relations(logs, ({ one }) => ({
	user: one(users, {
		fields: [logs.userId],
		references: [users.id],
	}),
}));

export interface LogEntry extends InferSelectModel<typeof logs> {
	tags: string[];
}
export interface NewLogEntry extends InferInsertModel<typeof logs> {}

export const treasuries = pgTable(
	"treasuries",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		address: text("address").notNull().unique(), // Ethereum address (Safe/Multisig)
		name: text("name").notNull(),
		purpose: text("purpose"), // Description of what this treasury is for
		chain: text("chain").default("mainnet").notNull(), // ethereum, polygon, arbitrum, etc.
		type: text("type").default("safe").notNull(), // safe, gnosis-safe, multisig, eoa
		threshold: integer("threshold"), // Number of signers required (for Safe)
		owners: text("owners").array().default(sql`ARRAY[]::text[]`), // List of owner addresses
		metadata: json("metadata").$type<{
			version?: string; // Safe version
			modules?: string[]; // Enabled modules
			guard?: string; // Guard address
			fallbackHandler?: string;
			nonce?: number;
		}>(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("treasuries_address_idx").on(table.address),
		index("treasuries_active_idx")
			.on(table.isActive)
			.where(sql`${table.isActive} = true`),
		// Public can view active treasuries
		pgPolicy("treasuries_select_public", {
			as: "permissive",
			to: publicRole,
			for: "select",
			using: sql`is_active = true`,
		}),
		// Authenticated users can view all treasuries
		pgPolicy("treasuries_select_authenticated", {
			as: "permissive",
			to: authenticatedRole,
			for: "select",
			using: sql`true`,
		}),
		// Only admins can create treasuries
		pgPolicy("treasuries_insert_admin", {
			as: "permissive",
			to: adminRole,
			for: "insert",
			withCheck: sql`true`,
		}),
		// Only admins can update treasuries
		pgPolicy("treasuries_update_admin", {
			as: "permissive",
			to: adminRole,
			for: "update",
			using: sql`true`,
			withCheck: sql`true`,
		}),
		// Only admins can delete treasuries
		pgPolicy("treasuries_delete_admin", {
			as: "permissive",
			to: adminRole,
			for: "delete",
			using: sql`true`,
		}),
	],
).enableRLS();

export const projectTreasuries = pgTable(
	"project_treasuries",
	{
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		treasuryId: uuid("treasury_id")
			.notNull()
			.references(() => treasuries.id, { onDelete: "cascade" }),
		addedBy: uuid("added_by")
			.notNull()
			.references(() => users.id),
		role: text("role").default("primary").notNull(), // primary, secondary, funding, etc.
		description: text("description"), // Project-specific description for this treasury
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.projectId, table.treasuryId] }),
		index("project_treasuries_project_idx").on(table.projectId),
		index("project_treasuries_treasury_idx").on(table.treasuryId),
		// Project owners can view their project treasuries
		pgPolicy("project_treasuries_select_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "select",
			using: sql`EXISTS (
				SELECT 1 FROM ${projects}
				WHERE ${projects}.id = project_id
				AND ${projects}.user_id = current_setting('app.current_user_id', true)::uuid
			)`,
		}),
		// Public can view treasuries of public projects
		pgPolicy("project_treasuries_select_public", {
			as: "permissive",
			to: publicRole,
			for: "select",
			using: sql`EXISTS (
				SELECT 1 FROM ${projects}
				WHERE ${projects}.id = project_id
				AND ${projects}.is_public = true
			)`,
		}),
		// Project owners can add treasuries to their projects
		pgPolicy("project_treasuries_insert_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "insert",
			withCheck: sql`EXISTS (
				SELECT 1 FROM ${projects}
				WHERE ${projects}.id = project_id
				AND ${projects}.user_id = current_setting('app.current_user_id', true)::uuid
			) AND added_by = current_setting('app.current_user_id', true)::uuid`,
		}),
		// Project owners can update their project treasuries
		pgPolicy("project_treasuries_update_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "update",
			using: sql`EXISTS (
				SELECT 1 FROM ${projects}
				WHERE ${projects}.id = project_id
				AND ${projects}.user_id = current_setting('app.current_user_id', true)::uuid
			)`,
			withCheck: sql`EXISTS (
				SELECT 1 FROM ${projects}
				WHERE ${projects}.id = project_id
				AND ${projects}.user_id = current_setting('app.current_user_id', true)::uuid
			)`,
		}),
		// Project owners can remove treasuries from their projects
		pgPolicy("project_treasuries_delete_own", {
			as: "permissive",
			to: authenticatedRole,
			for: "delete",
			using: sql`EXISTS (
				SELECT 1 FROM ${projects}
				WHERE ${projects}.id = project_id
				AND ${projects}.user_id = current_setting('app.current_user_id', true)::uuid
			)`,
		}),
		// Admins can manage all project treasuries
		pgPolicy("project_treasuries_admin", {
			as: "permissive",
			to: adminRole,
			for: "all",
			using: sql`true`,
			withCheck: sql`true`,
		}),
	],
).enableRLS();

export const treasuriesRelations = relations(treasuries, ({ many }) => ({
	projectTreasuries: many(projectTreasuries),
}));

export const projectTreasuriesRelations = relations(projectTreasuries, ({ one }) => ({
	project: one(projects, {
		fields: [projectTreasuries.projectId],
		references: [projects.id],
	}),
	treasury: one(treasuries, {
		fields: [projectTreasuries.treasuryId],
		references: [treasuries.id],
	}),
	addedByUser: one(users, {
		fields: [projectTreasuries.addedBy],
		references: [users.id],
	}),
}));

export interface Treasury extends InferSelectModel<typeof treasuries> {
	owners: string[];
}
export interface NewTreasury extends InferInsertModel<typeof treasuries> {}

export interface ProjectTreasury extends InferSelectModel<typeof projectTreasuries> {}
export interface NewProjectTreasury extends InferInsertModel<typeof projectTreasuries> {}
