-- First, drop the existing primary key constraint
ALTER TABLE "channel_settings" DROP CONSTRAINT IF EXISTS "channel_settings_pkey";

-- Add the new id column with UUID
ALTER TABLE "channel_settings" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid() NOT NULL;

-- Add the key column
ALTER TABLE "channel_settings" ADD COLUMN IF NOT EXISTS "key" text;

-- Rename text_channel_id to channel_id
ALTER TABLE "channel_settings" RENAME COLUMN "text_channel_id" TO "channel_id";

-- Update existing rows to set proper key values
UPDATE "channel_settings" 
SET "key" = 'text' 
WHERE "key" IS NULL AND "channel_id" IS NOT NULL;

-- Insert voice channel entries from existing data
INSERT INTO "channel_settings" ("guild_id", "key", "channel_id", "created_at", "updated_at", "id")
SELECT 
  "guild_id",
  'voice' as "key",
  "voice_channel_id" as "channel_id",
  "created_at",
  "updated_at",
  gen_random_uuid() as "id"
FROM "channel_settings"
WHERE "voice_channel_id" IS NOT NULL;

-- Now make key NOT NULL after data is migrated
ALTER TABLE "channel_settings" ALTER COLUMN "key" SET NOT NULL;

-- Drop the old voice_channel_id column
ALTER TABLE "channel_settings" DROP COLUMN IF EXISTS "voice_channel_id";

-- Set the new primary key
ALTER TABLE "channel_settings" ADD PRIMARY KEY ("id");

-- Create index for guild_id and key
CREATE INDEX IF NOT EXISTS "channel_settings_guild_key_idx" ON "channel_settings" USING btree ("guild_id","key");