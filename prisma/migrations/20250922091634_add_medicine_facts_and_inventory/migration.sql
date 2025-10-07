-- CreateTable
CREATE TABLE "public"."MedicineFacts" (
    "id" SERIAL NOT NULL,
    "medicineId" INTEGER NOT NULL,
    "slipsCount" INTEGER,
    "tabletsPerSlip" INTEGER,
    "totalTablets" INTEGER,
    "mrpAmount" DECIMAL(12,2),
    "mrpCurrency" TEXT,
    "mrpText" TEXT,
    "inferredUses" TEXT[],
    "careNotes" TEXT[],
    "sideEffectsCommon" TEXT[],
    "avoidIf" TEXT[],
    "precautions" TEXT[],
    "interactionsKey" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicineFacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MedicineFacts_medicineId_key" ON "public"."MedicineFacts"("medicineId");

-- AddForeignKey
ALTER TABLE "public"."MedicineFacts" ADD CONSTRAINT "MedicineFacts_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "public"."Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
