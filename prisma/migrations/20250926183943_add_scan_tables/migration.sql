-- CreateTable
CREATE TABLE "public"."Scan" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawText" TEXT,
    "aiData" JSONB NOT NULL,
    "name" VARCHAR(200),
    "batchNumber" VARCHAR(40),
    "mfgDate" TIMESTAMP(3),
    "expDate" TIMESTAMP(3),

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScanImage" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "ScanImage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."ScanImage" ADD CONSTRAINT "ScanImage_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "public"."Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
