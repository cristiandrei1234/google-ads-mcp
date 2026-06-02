/*
  Warnings:

  - You are about to drop the column `redirectURLs` on the `OauthApplication` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "OauthApplication" DROP COLUMN "redirectURLs",
ADD COLUMN     "redirectUrls" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL;
