import { randomBytes, createHash } from "crypto";
import jwt from "jsonwebtoken";
import { db, accessTokens, refreshTokens } from "../../client";
import { eq, and, gte, isNull } from "drizzle-orm";
import type { AccessToken, RefreshToken } from "../../schema";

// Token configuration
const ACCESS_TOKEN_EXPIRY = 15 * 60; // 15 minutes in seconds
const REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60; // 30 days in seconds
const TOKEN_LENGTH = 32; // bytes

const JWT_SECRET = process.env.JWT_SECRET || Bun.env?.JWT_SECRET;
if (!JWT_SECRET) {
	throw new Error("JWT_SECRET is not set");
}

/**
 * Generate a cryptographically secure random token
 */
export function generateSecureToken(): string {
	return randomBytes(TOKEN_LENGTH).toString("base64url");
}

/**
 * Hash a token for storage
 */
export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate an access token JWT
 */
export function generateAccessToken(
	userId: string,
	scopes: string[] = ["read", "write"],
	clientId?: string,
): string {
	if (!JWT_SECRET) {
		throw new Error("JWT_SECRET is not configured");
	}
	return jwt.sign(
		{
			sub: userId,
			scopes,
			clientId,
			type: "access",
			iat: Math.floor(Date.now() / 1000),
		},
		JWT_SECRET,
		{ expiresIn: ACCESS_TOKEN_EXPIRY },
	);
}

/**
 * Generate a refresh token (random string, not JWT)
 */
export function generateRefreshToken(): string {
	return `crt_ref_${generateSecureToken()}`;
}

/**
 * Verify and decode an access token
 */
export function verifyAccessToken(token: string): {
	userId: string;
	scopes: string[];
	clientId?: string;
} | null {
	if (!JWT_SECRET) {
		return null;
	}
	try {
		const payload = jwt.verify(token, JWT_SECRET) as any;
		if (payload.type !== "access") {
			return null;
		}
		return {
			userId: payload.sub,
			scopes: payload.scopes || ["read", "write"],
			clientId: payload.clientId,
		};
	} catch {
		return null;
	}
}

/**
 * Create and store access token in database
 */
export async function createAccessToken(
	userId: string,
	scopes: string[] = ["read", "write"],
	clientId?: string,
): Promise<{ token: string; expiresIn: number }> {
	const token = generateAccessToken(userId, scopes, clientId);
	const tokenHash = hashToken(token);
	const expiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY * 1000);

	await db.insert(accessTokens).values({
		userId,
		tokenHash,
		scopes,
		clientId,
		expiresAt,
	});

	return {
		token,
		expiresIn: ACCESS_TOKEN_EXPIRY,
	};
}

/**
 * Create and store refresh token in database
 */
export async function createRefreshToken(
	userId: string,
	familyId: string,
	clientId?: string,
): Promise<{ token: string; expiresIn: number }> {
	const token = generateRefreshToken();
	const tokenHash = hashToken(token);
	const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY * 1000);

	await db.insert(refreshTokens).values({
		userId,
		tokenHash,
		familyId,
		clientId,
		expiresAt,
	});

	return {
		token,
		expiresIn: REFRESH_TOKEN_EXPIRY,
	};
}

/**
 * Validate refresh token and check for reuse
 */
export async function validateRefreshToken(
	token: string,
): Promise<{ valid: boolean; refreshToken?: RefreshToken; familyId?: string }> {
	const tokenHash = hashToken(token);
	const now = new Date();

	const refreshToken = await db.query.refreshTokens.findFirst({
		where: and(
			eq(refreshTokens.tokenHash, tokenHash),
			gte(refreshTokens.expiresAt, now),
		),
	});

	if (!refreshToken) {
		return { valid: false };
	}

	// Check if token was already used (potential token theft)
	if (refreshToken.usedAt) {
		// Revoke entire token family for security
		await db
			.update(refreshTokens)
			.set({ revokedAt: now })
			.where(eq(refreshTokens.familyId, refreshToken.familyId));

		return { valid: false, familyId: refreshToken.familyId };
	}

	// Check if token was revoked
	if (refreshToken.revokedAt) {
		return { valid: false };
	}

	return { valid: true, refreshToken };
}

/**
 * Rotate refresh token (mark old as used, create new)
 */
export async function rotateRefreshToken(
	oldToken: string,
	clientId?: string,
): Promise<{
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	refreshExpiresIn: number;
} | null> {
	const validation = await validateRefreshToken(oldToken);

	if (!validation.valid || !validation.refreshToken) {
		return null;
	}

	const { refreshToken } = validation;

	// Mark old token as used
	await db
		.update(refreshTokens)
		.set({ usedAt: new Date() })
		.where(eq(refreshTokens.id, refreshToken.id));

	// Create new tokens
	const newAccess = await createAccessToken(
		refreshToken.userId,
		["read", "write"],
		clientId || refreshToken.clientId || undefined,
	);

	const newRefresh = await createRefreshToken(
		refreshToken.userId,
		refreshToken.familyId, // Keep same family ID for rotation tracking
		clientId || refreshToken.clientId || undefined,
	);

	return {
		accessToken: newAccess.token,
		refreshToken: newRefresh.token,
		expiresIn: newAccess.expiresIn,
		refreshExpiresIn: newRefresh.expiresIn,
	};
}

/**
 * Revoke all refresh tokens for a user
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
	const now = new Date();

	await db
		.update(refreshTokens)
		.set({ revokedAt: now })
		.where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

/**
 * Clean up expired tokens (for periodic maintenance)
 */
export async function cleanupExpiredTokens(): Promise<{
	accessTokensDeleted: number;
	refreshTokensDeleted: number;
}> {
	const now = new Date();

	// Delete expired access tokens
	const deletedAccess = await db
		.delete(accessTokens)
		.where(gte(accessTokens.expiresAt, now));

	// Delete expired or revoked refresh tokens older than 90 days
	const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
	const deletedRefresh = await db
		.delete(refreshTokens)
		.where(gte(refreshTokens.createdAt, cutoffDate));

	return {
		accessTokensDeleted: deletedAccess.length,
		refreshTokensDeleted: deletedRefresh.length,
	};
}