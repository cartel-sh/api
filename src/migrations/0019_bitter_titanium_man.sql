-- Drop the old text column
ALTER TABLE "treasuries" DROP COLUMN "chain";
--> statement-breakpoint
-- Add new integer array column with correct type
ALTER TABLE "treasuries" ADD COLUMN "chain_ids" integer[] DEFAULT ARRAY[1]::integer[] NOT NULL;