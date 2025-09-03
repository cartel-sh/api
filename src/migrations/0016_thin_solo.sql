ALTER TABLE "user_identities" ADD COLUMN "metadata" json;--> statement-breakpoint
ALTER TABLE "user_identities" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_identities" ADD COLUMN "oauth_access_token" text;--> statement-breakpoint
ALTER TABLE "user_identities" ADD COLUMN "oauth_refresh_token" text;--> statement-breakpoint
ALTER TABLE "user_identities" ADD COLUMN "oauth_token_expires_at" timestamp with time zone;