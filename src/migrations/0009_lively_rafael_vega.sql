CREATE ROLE "admin";--> statement-breakpoint
CREATE ROLE "authenticated";--> statement-breakpoint
CREATE ROLE "member";--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "application_votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "practice_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vanishing_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "access_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "access_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'authenticated' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_member" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "scopes";--> statement-breakpoint
DROP POLICY "projects_select_own_or_public" ON "projects" CASCADE;--> statement-breakpoint
DROP POLICY "projects_insert_own" ON "projects" CASCADE;--> statement-breakpoint
CREATE POLICY "api_keys_own" ON "api_keys" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = current_setting('app.current_user_id', true)::uuid) WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "api_keys_admin" ON "api_keys" AS PERMISSIVE FOR ALL TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "application_votes_member" ON "application_votes" AS PERMISSIVE FOR ALL TO "member" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "application_votes_admin" ON "application_votes" AS PERMISSIVE FOR ALL TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "applications_select_member" ON "applications" AS PERMISSIVE FOR SELECT TO "member" USING (true);--> statement-breakpoint
CREATE POLICY "applications_admin_all" ON "applications" AS PERMISSIVE FOR ALL TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "channel_settings_admin_all" ON "channel_settings" AS PERMISSIVE FOR ALL TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "practice_sessions_own" ON "practice_sessions" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = current_setting('app.current_user_id', true)::uuid) WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "practice_sessions_admin" ON "practice_sessions" AS PERMISSIVE FOR ALL TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "projects_select_public" ON "projects" AS PERMISSIVE FOR SELECT TO public USING (is_public = true);--> statement-breakpoint
CREATE POLICY "projects_select_authenticated" ON "projects" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_public = true OR user_id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "projects_select_member" ON "projects" AS PERMISSIVE FOR SELECT TO "member" USING (true);--> statement-breakpoint
CREATE POLICY "projects_select_admin" ON "projects" AS PERMISSIVE FOR SELECT TO "admin" USING (true);--> statement-breakpoint
CREATE POLICY "projects_insert_authenticated" ON "projects" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "projects_update_admin" ON "projects" AS PERMISSIVE FOR UPDATE TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "projects_delete_admin" ON "projects" AS PERMISSIVE FOR DELETE TO "admin" USING (true);--> statement-breakpoint
CREATE POLICY "refresh_tokens_own" ON "refresh_tokens" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = current_setting('app.current_user_id', true)::uuid) WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "refresh_tokens_admin" ON "refresh_tokens" AS PERMISSIVE FOR ALL TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "user_identities_select_own" ON "user_identities" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "user_identities_select_admin" ON "user_identities" AS PERMISSIVE FOR SELECT TO "admin" USING (true);--> statement-breakpoint
CREATE POLICY "user_identities_insert_own" ON "user_identities" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "user_identities_insert_admin" ON "user_identities" AS PERMISSIVE FOR INSERT TO "admin" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "user_identities_update_own" ON "user_identities" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = current_setting('app.current_user_id', true)::uuid) WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "user_identities_update_admin" ON "user_identities" AS PERMISSIVE FOR UPDATE TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "user_identities_delete_own" ON "user_identities" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "user_identities_delete_admin" ON "user_identities" AS PERMISSIVE FOR DELETE TO "admin" USING (true);--> statement-breakpoint
CREATE POLICY "users_select_authenticated" ON "users" AS PERMISSIVE FOR SELECT TO "authenticated" USING (id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "users_select_members" ON "users" AS PERMISSIVE FOR SELECT TO "member" USING (true);--> statement-breakpoint
CREATE POLICY "users_select_admin" ON "users" AS PERMISSIVE FOR SELECT TO "admin" USING (true);--> statement-breakpoint
CREATE POLICY "users_update_self" ON "users" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (id = current_setting('app.current_user_id', true)::uuid) WITH CHECK (id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "users_update_admin" ON "users" AS PERMISSIVE FOR UPDATE TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "users_delete_admin" ON "users" AS PERMISSIVE FOR DELETE TO "admin" USING (true);--> statement-breakpoint
CREATE POLICY "vanishing_channels_admin_all" ON "vanishing_channels" AS PERMISSIVE FOR ALL TO "admin" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER POLICY "projects_update_own" ON "projects" TO authenticated USING (user_id = current_setting('app.current_user_id', true)::uuid) WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint
ALTER POLICY "projects_delete_own" ON "projects" TO authenticated USING (user_id = current_setting('app.current_user_id', true)::uuid);