ALTER TABLE "user_identities" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_identities" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_identities_primary_idx" ON "user_identities" USING btree ("user_id","is_primary") WHERE "user_identities"."is_primary" = true;