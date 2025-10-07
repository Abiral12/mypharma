/*
  Warnings:

  - A unique constraint covering the columns `[userId,batchNo]` on the table `InventoryBatch` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."InventoryBatch" ALTER COLUMN "costPrice" DROP NOT NULL,
ALTER COLUMN "costPrice" DROP DEFAULT,
ALTER COLUMN "costPrice" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "mrp" DROP NOT NULL,
ALTER COLUMN "mrp" DROP DEFAULT,
ALTER COLUMN "mrp" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "public"."Medicine" ALTER COLUMN "mrp" SET DATA TYPE DECIMAL(12,2);

-- CreateTable
CREATE TABLE "public"."InventoryShelfAlloc" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "shelfId" TEXT,
    "shelfName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryShelfAlloc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBatch_userId_batchNo_key" ON "public"."InventoryBatch"("userId", "batchNo");

-- AddForeignKey
ALTER TABLE "public"."InventoryShelfAlloc" ADD CONSTRAINT "InventoryShelfAlloc_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "public"."InventoryBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
