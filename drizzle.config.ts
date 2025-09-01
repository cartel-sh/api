import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config();

const isTestEnv = process.env.NODE_ENV === "test";
const databaseUrl = isTestEnv ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;

if (!databaseUrl) {
	const envVar = isTestEnv ? "TEST_DATABASE_URL" : "DATABASE_URL";
	throw new Error(`${envVar} environment variable is required`);
}

export default defineConfig({
	schema: "./src/schema.ts",
	out: "./src/migrations",
	dialect: "postgresql",
	dbCredentials: {
		url: databaseUrl,
	},
	verbose: isTestEnv ? false : true, // Reduce noise during tests
	strict: true,
});
