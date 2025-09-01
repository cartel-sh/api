import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

const isTestEnv = process.env.NODE_ENV === "test";
const databaseUrl = isTestEnv 
	? (process.env.TEST_DATABASE_URL || Bun.env.TEST_DATABASE_URL)
	: (process.env.DATABASE_URL || Bun.env.DATABASE_URL);

if (!databaseUrl) {
	const envVar = isTestEnv ? "TEST_DATABASE_URL" : "DATABASE_URL";
	throw new Error(`${envVar} is not set`);
}

const connectionOptions = {
	prepare: true,
	max: 10,
	idle_timeout: 20,
};

export const queryClient = postgres(databaseUrl, connectionOptions);

export const db = drizzle(queryClient, {
	schema,
	logger: process.env.NODE_ENV === "development",
});

import type { UserRole } from "./schema";

/**
 * Execute a database operation with RLS user context
 * Sets both user ID and PostgreSQL role for the transaction, enabling RLS policies
 * 
 * Note: PostgreSQL's SET LOCAL doesn't support parameterized values, so we must use sql.raw() here. 
 */
export async function withUser<T>(
	userId: string | null,
	userRole: UserRole | 'public' | null,
	callback: (tx: any) => Promise<T>,
): Promise<T> {
	if (userId && !/^[a-zA-Z0-9-_]+$/.test(userId)) {
		throw new Error('Invalid user ID format');
	}

	if (userRole && !['authenticated', 'member', 'admin', 'public'].includes(userRole)) {
		throw new Error('Invalid user role');
	}
	
	return db.transaction(async (tx) => {
		if (userId) {
			await tx.execute(sql`SET LOCAL app.current_user_id = '${sql.raw(userId)}'`);
		}
		
		// Map our roles to PostgreSQL roles
		if (userRole) {
			await tx.execute(sql`SET LOCAL app.current_user_role = '${sql.raw(userRole)}'`);
			
			// Map to actual PostgreSQL role if we have proper privileges
			// const pgRole = userRole === 'public' ? 'public' : userRole;
			// await tx.execute(sql`SET LOCAL ROLE ${sql.identifier(pgRole)}`);
		} else if (!userId) {
			// No user and no role means public access
			await tx.execute(sql`SET LOCAL app.current_user_role = '${sql.raw('public')}'`);
		}
		
		return callback(tx);
	});
}

/**
 * Execute a database operation with public access (no authentication)
 */
export async function withPublicAccess<T>(
	callback: (tx: any) => Promise<T>,
): Promise<T> {
	// Public access doesn't set user ID or role, relying on default RLS policies
	return db.transaction(async (tx) => {
		// Optionally set role to public explicitly
		await tx.execute(sql`SET LOCAL ROLE ${sql.identifier('public')}`);
		return callback(tx);
	});
}

export * from "./schema";
