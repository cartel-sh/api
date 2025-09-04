CREATE TABLE IF NOT EXISTS "project_treasuries" (
	"project_id" uuid NOT NULL,
	"treasury_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "project_treasuries_project_id_treasury_id_pk" PRIMARY KEY("project_id","treasury_id")
);
--> statement-breakpoint
ALTER TABLE "project_treasuries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "treasuries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"chain" text DEFAULT 'mainnet' NOT NULL,
	"type" text DEFAULT 'safe' NOT NULL,
	"threshold" integer,
	"owners" text[] DEFAULT ARRAY[]::text[],
	"metadata" json,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "treasuries_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "treasuries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_treasuries" ADD CONSTRAINT "project_treasuries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_treasuries" ADD CONSTRAINT "project_treasuries_treasury_id_treasuries_id_fk" FOREIGN KEY ("treasury_id") REFERENCES "public"."treasuries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_treasuries" ADD CONSTRAINT "project_treasuries_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_treasuries_project_idx" ON "project_treasuries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_treasuries_treasury_idx" ON "project_treasuries" USING btree ("treasury_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "treasuries_address_idx" ON "treasuries" USING btree ("address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "treasuries_active_idx" ON "treasuries" USING btree ("is_active") WHERE "treasuries"."is_active" = true;--> statement-breakpoint
CREATE POLICY "project_treasuries_select_own" ON "project_treasuries" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS (
				SELECT 1 FROM "projects"
				WHERE "projects".id = project_id
				AND "projects".user_id = current_setting('app.current_user_id', true)::uuid
			));--> statement-breakpoint
CREATE POLICY "project_treasuries_select_public" ON "project_treasuries" AS PERMISSIVE FOR SELECT TO public USING (EXISTS (
				SELECT 1 FROM "projects"
				WHERE "projects".id = project_id
				AND "projects".is_public = true
			));--> statement-breakpoint
CREATE POLICY "project_treasuries_insert_own" ON "project_treasuries" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (EXISTS (
				SELECT 1 FROM "projects"
				WHERE "projects".id = project_id
				AND "projects".user_id = current_setting('app.current_user_id', true)::uuid
			) AND added_by = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "project_treasuries_update_own" ON "project_treasuries" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (EXISTS (
				SELECT 1 FROM "projects"
				WHERE "projects".id = project_id
				AND "projects".user_id = current_setting('app.current_user_id', true)::uuid
			)) WITH CHECK (EXISTS (
				SELECT 1 FROM "projects"
				WHERE "projects".id = project_id
				AND "projects".user_id = current_setting('app.current_user_id', true)::uuid
			));--> statement-breakpoint
CREATE POLICY "project_treasuries_delete_own" ON "project_treasuries" AS PERMISSIVE FOR DELETE TO "authenticated" USING (EXISTS (
				SELECT 1 FROM "projects"
				WHERE "projects".id = project_id
				AND "projects".user_id = current_setting('app.current_user_id', true)::uuid
			));--> statement-breakpoint
CREATE POLICY "project_treasuries_admin" ON "project_treasuries" AS PERMISSIVE FOR ALL TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "treasuries_select_public" ON "treasuries" AS PERMISSIVE FOR SELECT TO public USING (is_active = true);--> statement-breakpoint
CREATE POLICY "treasuries_select_authenticated" ON "treasuries" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "treasuries_insert_admin" ON "treasuries" AS PERMISSIVE FOR INSERT TO "admin" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "treasuries_update_admin" ON "treasuries" AS PERMISSIVE FOR UPDATE TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "treasuries_delete_admin" ON "treasuries" AS PERMISSIVE FOR DELETE TO "admin" USING (true);