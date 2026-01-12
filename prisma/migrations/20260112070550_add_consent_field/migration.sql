/*
  Warnings:

  - You are about to drop the column `phoneNumber` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `studentId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `titleName` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `AvailabilitySlot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Booking` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CaseNote` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `roleName` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "AvailabilitySlot" DROP CONSTRAINT "AvailabilitySlot_counselorId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_slotId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_studentId_fkey";

-- DropForeignKey
ALTER TABLE "CaseNote" DROP CONSTRAINT "CaseNote_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "CaseNote" DROP CONSTRAINT "CaseNote_counselorId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "phoneNumber",
DROP COLUMN "role",
DROP COLUMN "studentId",
DROP COLUMN "titleName",
DROP COLUMN "updatedAt",
ADD COLUMN     "consentAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "isConsentAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phoneNum" TEXT,
ADD COLUMN     "pswHash" TEXT,
ADD COLUMN     "roleName" TEXT NOT NULL;

-- DropTable
DROP TABLE "AvailabilitySlot";

-- DropTable
DROP TABLE "Booking";

-- DropTable
DROP TABLE "CaseNote";

-- CreateTable
CREATE TABLE "RegistrationCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "usedBy" TEXT,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "RegistrationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "userId" INTEGER NOT NULL,
    "studentId" TEXT NOT NULL,
    "major" TEXT,
    "department" TEXT,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Counselor" (
    "userId" INTEGER NOT NULL,
    "counselorNumber" TEXT,

    CONSTRAINT "Counselor_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Admin" (
    "userId" INTEGER NOT NULL,
    "adminNumber" TEXT,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Case" (
    "caseId" SERIAL NOT NULL,
    "topic" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting_confirmation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studentId" TEXT NOT NULL,
    "counselorId" INTEGER,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("caseId")
);

-- CreateTable
CREATE TABLE "ProblemTag" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "ProblemTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionId" SERIAL NOT NULL,
    "sessionName" TEXT,
    "timeStart" TIMESTAMP(3) NOT NULL,
    "timeEnd" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caseId" INTEGER,
    "counselorId" INTEGER,
    "counselorNote" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "_ProblemTagToSession" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationCode_code_key" ON "RegistrationCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Student_studentId_key" ON "Student"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemTag_label_key" ON "ProblemTag"("label");

-- CreateIndex
CREATE UNIQUE INDEX "_ProblemTagToSession_AB_unique" ON "_ProblemTagToSession"("A", "B");

-- CreateIndex
CREATE INDEX "_ProblemTagToSession_B_index" ON "_ProblemTagToSession"("B");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counselor" ADD CONSTRAINT "Counselor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("studentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_counselorId_fkey" FOREIGN KEY ("counselorId") REFERENCES "Counselor"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("caseId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_counselorId_fkey" FOREIGN KEY ("counselorId") REFERENCES "Counselor"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProblemTagToSession" ADD CONSTRAINT "_ProblemTagToSession_A_fkey" FOREIGN KEY ("A") REFERENCES "ProblemTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProblemTagToSession" ADD CONSTRAINT "_ProblemTagToSession_B_fkey" FOREIGN KEY ("B") REFERENCES "Session"("sessionId") ON DELETE CASCADE ON UPDATE CASCADE;
