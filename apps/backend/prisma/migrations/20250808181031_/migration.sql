-- AlterTable
ALTER TABLE "public"."audit_logs" ADD COLUMN     "correlation_id" VARCHAR(64),
ADD COLUMN     "tenant_id" UUID;

-- CreateTable
CREATE TABLE "public"."role_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role" "public"."UserRole" NOT NULL,
    "granted_by" UUID NOT NULL,
    "reason" TEXT,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_grants_user_id_idx" ON "public"."role_grants"("user_id");

-- AddForeignKey
ALTER TABLE "public"."role_grants" ADD CONSTRAINT "role_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
