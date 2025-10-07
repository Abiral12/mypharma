-- AlterTable
ALTER TABLE "public"."InventoryShelfAlloc" ADD COLUMN     "shelfRefId" INTEGER;

-- CreateTable
CREATE TABLE "public"."PharmacyShelf" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "location" TEXT,
    "capacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyShelf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PharmacyShelf_userId_idx" ON "public"."PharmacyShelf"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyShelf_userId_name_key" ON "public"."PharmacyShelf"("userId", "name");

-- CreateIndex
CREATE INDEX "InventoryShelfAlloc_batchId_idx" ON "public"."InventoryShelfAlloc"("batchId");

-- CreateIndex
CREATE INDEX "InventoryShelfAlloc_shelfRefId_idx" ON "public"."InventoryShelfAlloc"("shelfRefId");

-- AddForeignKey
ALTER TABLE "public"."PharmacyShelf" ADD CONSTRAINT "PharmacyShelf_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryShelfAlloc" ADD CONSTRAINT "InventoryShelfAlloc_shelfRefId_fkey" FOREIGN KEY ("shelfRefId") REFERENCES "public"."PharmacyShelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;
