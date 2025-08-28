import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL || Bun.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
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

/**
 * Execute a database operation with RLS user context
 * The user ID is set for the transaction, and RLS policies will apply
 */
export async function withUser<T>(
  userId: string | null,
  callback: (tx: any) => Promise<T>
): Promise<T> {
  if (!userId) {
    // No user context, just execute normally
    return callback(db);
  }
  
  // Use a transaction to set the user context
  return db.transaction(async (tx) => {
    // Set the user ID for this transaction
    // RLS policies will use this to filter data
    await tx.execute(sql`SET LOCAL app.current_user_id = ${userId}`);
    return callback(tx);
  });
}

export * from "./schema";
