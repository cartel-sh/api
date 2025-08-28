ALTER TABLE "api_keys" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "allowed_origins" text[];