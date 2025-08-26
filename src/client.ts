import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
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

export * from "./schema";
