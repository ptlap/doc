-- Tenancy structures
CREATE TABLE IF NOT EXISTS "tenants" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(255) UNIQUE NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add tenant columns (nullable for backward compatibility)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenant_id" UUID;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "tenant_id" UUID;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "tenant_id" UUID;

-- Foreign keys with SET NULL on delete
DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "documents"
    ADD CONSTRAINT "documents_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


