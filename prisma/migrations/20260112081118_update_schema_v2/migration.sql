-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'medium',
ADD COLUMN     "refCode" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "moodScale" INTEGER;
