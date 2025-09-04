ALTER TABLE "refresh_tokens" RENAME COLUMN "client_id" TO "client_name";--> statement-breakpoint
DROP POLICY "api_keys_own" ON "api_keys" CASCADE;--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "api_keys_user_id_idx";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "user_id";