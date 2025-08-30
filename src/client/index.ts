export {
	CartelClient,
	InMemoryTokenStorage,
	LocalStorageTokenStorage,
	type TokenStorage,
} from "./sdk";

// Export types from shared schemas
export type {
	AuthResponse,
	RefreshResponse,
	UserIdentityLookup,
	VanishingChannel,
	VanishingChannelSuccess,
	VanishingChannelStats,
	PracticeSession,
	PracticeStats,
	PracticeTotalHours,
	PracticeLeaderboardEntry,
	Application,
	ApplicationVote,
	User,
	UserIdentity,
	Project,
} from "../shared/schemas";

// Export Zod schemas for validation
export {
	AuthResponseSchema,
	RefreshResponseSchema,
	UserIdentityLookupSchema,
	VanishingChannelSchema,
	PracticeSessionSchema,
	ApplicationSchema,
	UserSchema,
	ProjectSchema,
} from "../shared/schemas";

export * from "../schema";