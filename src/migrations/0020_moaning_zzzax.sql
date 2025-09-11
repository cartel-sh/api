CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_id" uuid NOT NULL,
	"payload" json NOT NULL,
	"url" text NOT NULL,
	"status_code" integer,
	"response_body" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"events" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" json,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhook_subscriptions_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_id_idx" ON "webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_event_type_idx" ON "webhook_deliveries" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_event_id_idx" ON "webhook_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_retry_idx" ON "webhook_deliveries" USING btree ("next_retry_at") WHERE "webhook_deliveries"."next_retry_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_created_by_idx" ON "webhook_subscriptions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_active_idx" ON "webhook_subscriptions" USING btree ("is_active") WHERE "webhook_subscriptions"."is_active" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_events_idx" ON "webhook_subscriptions" USING gin ("events");--> statement-breakpoint
CREATE POLICY "webhook_deliveries_admin" ON "webhook_deliveries" AS PERMISSIVE FOR ALL TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "webhook_deliveries_select_own" ON "webhook_deliveries" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS (
				SELECT 1 FROM "webhook_subscriptions"
				WHERE "webhook_subscriptions".id = webhook_id
				AND "webhook_subscriptions".created_by = current_setting('app.current_user_id', true)::uuid
			));--> statement-breakpoint
CREATE POLICY "webhook_subscriptions_select_own" ON "webhook_subscriptions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (created_by = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "webhook_subscriptions_insert_own" ON "webhook_subscriptions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (created_by = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "webhook_subscriptions_update_own" ON "webhook_subscriptions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (created_by = current_setting('app.current_user_id', true)::uuid) WITH CHECK (created_by = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "webhook_subscriptions_delete_own" ON "webhook_subscriptions" AS PERMISSIVE FOR DELETE TO "authenticated" USING (created_by = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "webhook_subscriptions_admin" ON "webhook_subscriptions" AS PERMISSIVE FOR ALL TO "admin" USING (true) WITH CHECK (true);