ALTER TABLE "users" ADD COLUMN "address" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_address_idx" ON "users" USING btree ("address");