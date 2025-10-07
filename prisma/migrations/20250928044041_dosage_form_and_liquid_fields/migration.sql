-- CreateEnum
CREATE TYPE "public"."DosageForm" AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'SUSPENSION', 'SOLUTION', 'DROPS', 'INJECTION', 'OINTMENT', 'CREAM', 'GEL', 'OTHER');

-- AlterTable
ALTER TABLE "public"."Medicine" ADD COLUMN     "dosageForm" "public"."DosageForm";

-- AlterTable
ALTER TABLE "public"."MedicineFacts" ADD COLUMN     "bottleVolumeMl" INTEGER,
ADD COLUMN     "bottlesPerPack" INTEGER,
ADD COLUMN     "concentrationLabel" TEXT,
ADD COLUMN     "concentrationMgPer5ml" DECIMAL(12,3),
ADD COLUMN     "dosageFormLabel" TEXT;
