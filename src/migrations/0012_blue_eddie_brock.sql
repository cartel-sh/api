CREATE TABLE IF NOT EXISTS "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"data" text,
	"route" text,
	"method" text,
	"path" text,
	"status_code" integer,
	"duration" integer,
	"user_id" uuid,
	"user_role" text,
	"client_ip" text,
	"user_agent" text,
	"session_id" text,
	"environment" text,
	"version" text,
	"service" text DEFAULT 'cartel-api',
	"error_name" text,
	"error_stack" text,
	"tags" text[] DEFAULT ARRAY[]::text[],
	"category" text,
	"operation" text,
	"trace_id" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "logs" ADD CONSTRAINT "logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_timestamp_idx" ON "logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_level_timestamp_idx" ON "logs" USING btree ("level","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_user_timestamp_idx" ON "logs" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_route_timestamp_idx" ON "logs" USING btree ("route","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_category_timestamp_idx" ON "logs" USING btree ("category","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_message_search_idx" ON "logs" USING btree ("message");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_error_name_idx" ON "logs" USING btree ("error_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_tags_idx" ON "logs" USING gin ("tags");--> statement-breakpoint
CREATE POLICY "logs_admin_all" ON "logs" AS PERMISSIVE FOR ALL TO "admin" USING (true) WITH CHECK (true);