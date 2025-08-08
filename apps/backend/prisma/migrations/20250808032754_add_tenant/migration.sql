/*
  Warnings:

  - You are about to drop the column `created_at` on the `tenants` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."tenants" DROP COLUMN "created_at",
ADD COLUMN     "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
