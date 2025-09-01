import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

// Use TEST_DATABASE_URL in test environment, DATABASE_URL otherwise
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
 */
export async function withUser<T>(
	userId: string | null,
	userRole: UserRole | 'public' | null,
	callback: (tx: any) => Promise<T>,
): Promise<T> {
	// Use a transaction to set the user context and role
	return db.transaction(async (tx) => {
		// Set the user ID for RLS policies
		if (userId) {
			// SET LOCAL doesn't support parameterized values, need to construct the SQL
			await tx.execute(sql.raw(`SET LOCAL app.current_user_id = '${userId}'`));
		}
		
		// Map our application roles to PostgreSQL roles
		if (userRole) {
			// Store the role for RLS policies to check
			// SET LOCAL doesn't support parameterized values, need to construct the SQL
			await tx.execute(sql.raw(`SET LOCAL app.current_user_role = '${userRole}'`));
			
			// Map to actual PostgreSQL role if we have proper privileges
			// const pgRole = userRole === 'public' ? 'public' : userRole;
			// await tx.execute(sql`SET LOCAL ROLE ${sql.identifier(pgRole)}`);
		} else if (!userId) {
			// No user and no role means public access
			await tx.execute(sql.raw(`SET LOCAL app.current_user_role = 'public'`));
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
