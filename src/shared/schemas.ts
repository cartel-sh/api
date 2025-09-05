import { z } from "@hono/zod-openapi";

// ============================================
// Auth Schemas
// ============================================

export const AuthResponseSchema = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
	expiresIn: z.number(),
	tokenType: z.literal("Bearer"),
	userId: z.string(),
	address: z.string(),
	clientName: z.string().optional(),
});

export const RefreshResponseSchema = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
	expiresIn: z.number(),
	tokenType: z.literal("Bearer"),
});

export const SiweVerifyRequestSchema = z.object({
	message: z.string(),
	signature: z.string(),
});

// ============================================
// Vanishing Channel Schemas
// ============================================

export const CreateVanishingChannelSchema = z.object({
	channelId: z.string().describe("Discord channel ID"),
	guildId: z.string().describe("Discord guild ID"),
	duration: z.number().positive().describe("Vanish duration in seconds"),
});

export const VanishingChannelSchema = z.object({
	channelId: z.string(),
	guildId: z.string(),
	vanishAfter: z.number(),
	messagesDeleted: z.number(),
	lastDeletion: z.string().nullable(),
	createdAt: z.string().nullable(),
	updatedAt: z.string().nullable(),
});

export const VanishingChannelSuccessSchema = z.object({
	success: z.boolean(),
});

export const VanishingChannelStatsSchema = z.object({
	success: z.boolean(),
	newCount: z.number(),
});

// ============================================
// Practice Session Schemas
// ============================================

export const StartPracticeSessionSchema = z
	.object({
		discordId: z.string().optional(),
		userId: z.string().uuid().optional(),
		notes: z.string().optional(),
	})
	.refine((data) => data.discordId || data.userId, {
		message: "Either discordId or userId must be provided",
	});

export const StopPracticeSessionSchema = z
	.object({
		discordId: z.string().optional(),
		userId: z.string().uuid().optional(),
	})
	.refine((data) => data.discordId || data.userId, {
		message: "Either discordId or userId must be provided",
	});

export const PracticeSessionSchema = z.object({
	id: z.string(),
	userId: z.string(),
	startTime: z.string(),
	endTime: z.string().nullable(),
	duration: z.number().nullable(),
	date: z.string(),
	notes: z.string().nullable(),
});

export const PracticeStatsSchema = z.object({
	totalDuration: z.number(),
});

export const PracticeTotalHoursSchema = z.object({
	totalHours: z.number(),
});

export const PracticeLeaderboardEntrySchema = z.object({
	identity: z.string(),
	totalDuration: z.number(),
});

// ============================================
// Application Schemas
// ============================================

export const CreateApplicationSchema = z.object({
	messageId: z.string(),
	walletAddress: z.string(),
	ensName: z.string().nullable().optional(),
	github: z.string().nullable().optional(),
	farcaster: z.string().nullable().optional(),
	lens: z.string().nullable().optional(),
	twitter: z.string().nullable().optional(),
	excitement: z.string(),
	motivation: z.string(),
	signature: z.string(),
});

export const ApplicationSchema = z.object({
	id: z.string(),
	messageId: z.string(),
	guildId: z.string().optional(),
	channelId: z.string().optional(),
	applicantId: z.string().optional(),
	applicantName: z.string().optional(),
	responses: z.record(z.string(), z.string()).optional(),
	status: z.string(),
	applicationNumber: z.number(),
	walletAddress: z.string().optional(),
	ensName: z.string().nullable().optional(),
	github: z.string().nullable().optional(),
	farcaster: z.string().nullable().optional(),
	lens: z.string().nullable().optional(),
	twitter: z.string().nullable().optional(),
	excitement: z.string().optional(),
	motivation: z.string().optional(),
	signature: z.string().optional(),
	submittedAt: z.string().optional(),
	decidedAt: z.string().nullable().optional(),
});

export const ApplicationVoteSchema = z.object({
	userId: z.string(),
	userName: z.string(),
	voteType: z.enum(["approve", "reject"]),
});

// ============================================
// User Schemas
// ============================================

export const UserSchema = z.object({
	id: z.string(),
	address: z.string().optional(),
	role: z.string().optional(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
});

export const UserIdentitySchema = z.object({
	id: z.string().optional(),
	userId: z.string(),
	platform: z.string(),
	identity: z.string(),
	isPrimary: z.boolean(),
	metadata: z.object({
		username: z.string().optional(),
		displayName: z.string().optional(),
		avatarUrl: z.string().optional(),
		email: z.string().optional(),
		bio: z.string().optional(),
		profileUrl: z.string().optional(),
		oauthAccessToken: z.string().optional(),
	}).nullable().optional(),
	verifiedAt: z.string().datetime().nullable().optional(),
	createdAt: z.string().nullable().optional(),
	updatedAt: z.string().nullable().optional(),
});

export const UserIdentityLookupSchema = z.object({
	evm: z.string().optional(),
	lens: z.string().optional(),
	farcaster: z.string().optional(),
	telegram: z.string().optional(),
	discord: z.string().optional(),
});

export const AddUserIdentitySchema = z.object({
	userId: z.string(),
	platform: z.string(),
	identity: z.string(),
	isPrimary: z.boolean().optional(),
});

// ============================================
// Project Schemas
// ============================================

export const CreateProjectSchema = z.object({
	title: z.string().min(1).max(255),
	description: z.string().min(1),
	githubUrl: z.string().url().optional().nullable(),
	deploymentUrl: z.string().url().optional().nullable(),
	tags: z.array(z.string()).default([]),
	isPublic: z.boolean().default(true),
});

export const UpdateProjectSchema = CreateProjectSchema.partial();

export const ProjectSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	githubUrl: z.string().nullable(),
	deploymentUrl: z.string().nullable(),
	tags: z.array(z.string()).nullable(),
	isPublic: z.boolean(),
	userId: z.string(),
	createdAt: z.string().nullable(),
	updatedAt: z.string().nullable(),
});

export const ProjectWithUserSchema = ProjectSchema.extend({
	user: z.object({
		id: z.string(),
		role: z.string().optional(),
		ensName: z.string().nullable().optional(),
		ensAvatar: z.string().nullable().optional(),
		createdAt: z.string().optional(),
		updatedAt: z.string().optional(),
	}).optional(),
});

export const ProjectQuerySchema = z.object({
	search: z.string().optional(),
	tags: z.string().optional(),
	userId: z.string().optional(),
	public: z.enum(["true", "false", "all"]).default("true"),
	limit: z.coerce.number().default(50),
	offset: z.coerce.number().default(0),
});

export const PopularTagSchema = z.object({
	tag: z.string(),
	count: z.number(),
});

export const ProjectListResponseSchema = z.array(ProjectWithUserSchema);

export const PopularTagsResponseSchema = z.array(PopularTagSchema);

// ============================================
// Common Schemas
// ============================================

export const SuccessResponseSchema = z.object({
	success: z.boolean(),
});

export const ErrorResponseSchema = z.object({
	error: z.string(),
});

export const ErrorWithMessageResponseSchema = ErrorResponseSchema.extend({
	message: z.string().optional(),
});

export const ErrorWithDetailsResponseSchema = z.object({
	error: z.string(),
	details: z.string(),
});

// ============================================
// Auth Additional Schemas
// ============================================

export const AuthHeadersSchema = z.object({
	"X-API-Key": z.string().optional(),
});

export const RefreshTokenRequestSchema = z.object({
	refreshToken: z.string().describe("The refresh token"),
});

export const UserMeResponseSchema = z.object({
	userId: z.string(),
	address: z.string().optional(),
	user: z.object({
		id: z.string(),
		role: z.string(),
		address: z.string().nullable(),
		ensName: z.string().nullable(),
		ensAvatar: z.string().nullable(),
		createdAt: z.string().nullable(),
		updatedAt: z.string().nullable(),
	}),
});

export const RevokeTokensResponseSchema = z.object({
	message: z.string(),
});

// ============================================
// Log Management Schemas (Admin only)
// ============================================

export const LogQuerySchema = z.object({
	page: z.number().optional().default(1),
	limit: z.number().optional().default(50),
	level: z.enum(["info", "warn", "error", "fatal"]).optional(),
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	userId: z.string().uuid().optional(),
	route: z.string().optional(),
	method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
	statusCode: z.number().optional(),
	search: z.string().optional(),
	category: z.string().optional(),
	operation: z.string().optional(),
	environment: z.string().optional(),
	service: z.string().optional(),
	errorName: z.string().optional(),
	tags: z.array(z.string()).optional(),
	sortBy: z.enum(["timestamp", "level", "route", "duration", "statusCode"]).optional().default("timestamp"),
	sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const LogEntrySchema = z.object({
	id: z.string(),
	timestamp: z.string(),
	level: z.string(),
	message: z.string(),
	data: z.any().nullable(),
	route: z.string().nullable(),
	method: z.string().nullable(),
	path: z.string().nullable(),
	statusCode: z.number().nullable(),
	duration: z.number().nullable(),
	userId: z.string().nullable(),
	userRole: z.string().nullable(),
	clientIp: z.string().nullable(),
	userAgent: z.string().nullable(),
	sessionId: z.string().nullable(),
	environment: z.string().nullable(),
	version: z.string().nullable(),
	service: z.string().nullable(),
	errorName: z.string().nullable(),
	errorStack: z.string().nullable(),
	tags: z.array(z.string()),
	category: z.string().nullable(),
	operation: z.string().nullable(),
	traceId: z.string().nullable(),
	correlationId: z.string().nullable(),
	createdAt: z.string().nullable(),
});

export const LogsListResponseSchema = z.object({
	logs: z.array(LogEntrySchema),
	pagination: z.object({
		page: z.number(),
		limit: z.number(),
		total: z.number(),
		totalPages: z.number(),
	}),
});

export const LogStatsResponseSchema = z.object({
	totalLogs: z.number(),
	logsByLevel: z.object({
		info: z.number(),
		warn: z.number(),
		error: z.number(),
		fatal: z.number(),
	}),
	logsByRoute: z.array(z.object({
		route: z.string(),
		count: z.number(),
	})),
	recentErrors: z.array(z.object({
		errorName: z.string(),
		count: z.number(),
		lastOccurrence: z.string(),
	})),
});

export const LogCleanupResponseSchema = z.object({
	success: z.boolean(),
	message: z.string().optional(),
	deletedCount: z.number(),
});

// ============================================
// Type Exports (inferred from Zod schemas)
// ============================================

export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;
export type SiweVerifyRequest = z.infer<typeof SiweVerifyRequestSchema>;

export type CreateVanishingChannel = z.infer<typeof CreateVanishingChannelSchema>;
export type VanishingChannel = z.infer<typeof VanishingChannelSchema>;
export type VanishingChannelSuccess = z.infer<typeof VanishingChannelSuccessSchema>;
export type VanishingChannelStats = z.infer<typeof VanishingChannelStatsSchema>;

export type StartPracticeSession = z.infer<typeof StartPracticeSessionSchema>;
export type StopPracticeSession = z.infer<typeof StopPracticeSessionSchema>;
export type PracticeSession = z.infer<typeof PracticeSessionSchema>;
export type PracticeStats = z.infer<typeof PracticeStatsSchema>;
export type PracticeTotalHours = z.infer<typeof PracticeTotalHoursSchema>;
export type PracticeLeaderboardEntry = z.infer<typeof PracticeLeaderboardEntrySchema>;

export type CreateApplication = z.infer<typeof CreateApplicationSchema>;
export type Application = z.infer<typeof ApplicationSchema>;
export type ApplicationVote = z.infer<typeof ApplicationVoteSchema>;

export type User = z.infer<typeof UserSchema>;
export type UserIdentity = z.infer<typeof UserIdentitySchema>;
export type UserIdentityLookup = z.infer<typeof UserIdentityLookupSchema>;
export type AddUserIdentity = z.infer<typeof AddUserIdentitySchema>;

export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectWithUser = z.infer<typeof ProjectWithUserSchema>;
export type ProjectQuery = z.infer<typeof ProjectQuerySchema>;
export type PopularTag = z.infer<typeof PopularTagSchema>;

export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type ErrorWithMessageResponse = z.infer<typeof ErrorWithMessageResponseSchema>;
export type ErrorWithDetailsResponse = z.infer<typeof ErrorWithDetailsResponseSchema>;
export type AuthHeaders = z.infer<typeof AuthHeadersSchema>;
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;
export type RevokeTokensResponse = z.infer<typeof RevokeTokensResponseSchema>;

export type LogQuery = z.infer<typeof LogQuerySchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
export type LogsListResponse = z.infer<typeof LogsListResponseSchema>;
export type LogStatsResponse = z.infer<typeof LogStatsResponseSchema>;
export type LogCleanupResponse = z.infer<typeof LogCleanupResponseSchema>;

// ============================================
// Treasury Schemas
// ============================================

export const TreasurySchema = z.object({
	id: z.string().uuid(),
	address: z.string(),
	name: z.string(),
	purpose: z.string().nullable(),
	chain: z.string(),
	type: z.string(),
	threshold: z.number().nullable(),
	owners: z.array(z.string()),
	metadata: z.object({
		version: z.string().optional(),
		modules: z.array(z.string()).optional(),
		guard: z.string().optional(),
		fallbackHandler: z.string().optional(),
		nonce: z.number().optional(),
	}).nullable(),
	isActive: z.boolean(),
	createdAt: z.date().nullable(),
	updatedAt: z.date().nullable(),
});

export const CreateTreasurySchema = z.object({
	address: z.string().describe("Ethereum address of the treasury"),
	name: z.string().describe("Name of the treasury"),
	purpose: z.string().optional().describe("Purpose or description of the treasury"),
	chain: z.string().default("mainnet").describe("Blockchain network"),
	type: z.string().default("safe").describe("Type of treasury (safe, multisig, eoa)"),
	threshold: z.number().optional().describe("Required signatures for Safe"),
	owners: z.array(z.string()).optional().describe("List of owner addresses"),
	metadata: z.object({
		version: z.string().optional(),
		modules: z.array(z.string()).optional(),
		guard: z.string().optional(),
		fallbackHandler: z.string().optional(),
		nonce: z.number().optional(),
	}).optional(),
});

export const ProjectTreasurySchema = z.object({
	projectId: z.string().uuid(),
	treasuryId: z.string().uuid(),
	addedBy: z.string().uuid(),
	role: z.string(),
	description: z.string().nullable(),
	createdAt: z.date().nullable(),
	treasury: TreasurySchema.optional(),
});

export const AddProjectTreasurySchema = z.object({
	treasuryId: z.string().uuid().optional().describe("Existing treasury ID"),
	address: z.string().optional().describe("Treasury address for new treasury"),
	name: z.string().optional().describe("Name for new treasury"),
	purpose: z.string().optional().describe("Purpose for new treasury"),
	chain: z.string().default("mainnet").optional(),
	type: z.string().default("safe").optional(),
	role: z.string().default("primary").describe("Role of treasury in project"),
	description: z.string().optional().describe("Project-specific description"),
});

export const TreasuryQuerySchema = z.object({
	chain: z.string().optional().describe("Filter by blockchain network"),
	type: z.string().optional().describe("Filter by treasury type"),
	limit: z.coerce.number().optional().describe("Number of results to return"),
	offset: z.coerce.number().optional().describe("Number of results to skip"),
});

export const TreasuryWithProjectsSchema = TreasurySchema.extend({
	projects: z.array(z.object({
		id: z.string().uuid(),
		title: z.string(),
		description: z.string(),
		role: z.string(),
		projectDescription: z.string().nullable(),
	})).optional(),
});

// Type exports
export type Treasury = z.infer<typeof TreasurySchema>;
export type CreateTreasury = z.infer<typeof CreateTreasurySchema>;
export type ProjectTreasury = z.infer<typeof ProjectTreasurySchema>;
export type AddProjectTreasury = z.infer<typeof AddProjectTreasurySchema>;
export type TreasuryQuery = z.infer<typeof TreasuryQuerySchema>;
export type TreasuryWithProjects = z.infer<typeof TreasuryWithProjectsSchema>;

// Also export database types for compatibility
export type { NewTreasury, NewProjectTreasury } from "../schema";