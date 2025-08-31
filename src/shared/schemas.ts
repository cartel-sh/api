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
	user: z.any().optional(),
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

export const ProjectListResponseSchema = z.array(ProjectSchema);

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
	user: z.any(),
});

export const RevokeTokensResponseSchema = z.object({
	message: z.string(),
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