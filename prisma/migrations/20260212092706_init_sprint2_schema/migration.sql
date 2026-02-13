/*
  Warnings:

  - You are about to drop the column `refCode` on the `Case` table. All the data in the column will be lost.
  - You are about to drop the column `studentId` on the `Case` table. All the data in the column will be lost.
  - You are about to drop the column `topic` on the `Case` table. All the data in the column will be lost.
  - You are about to drop the column `usedBy` on the `RegistrationCode` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the column `pswHash` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Admin` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Student` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[queueToken]` on the table `Case` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `clientId` to the `Case` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_userId_fkey";

-- DropForeignKey
ALTER TABLE "Case" DROP CONSTRAINT "Case_studentId_fkey";

-- DropForeignKey
ALTER TABLE "Student" DROP CONSTRAINT "Student_userId_fkey";

-- AlterTable
ALTER TABLE "Case" DROP COLUMN "refCode",
DROP COLUMN "studentId",
DROP COLUMN "topic",
ADD COLUMN     "clientId" TEXT NOT NULL,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "homeEnteredAt" TIMESTAMP(3),
ADD COLUMN     "queueToken" TEXT,
ADD COLUMN     "waitingEnteredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProblemTag" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "RegistrationCode" DROP COLUMN "usedBy",
ADD COLUMN     "createdBy" TEXT;

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "location",
ADD COLUMN     "counselorFollowup" TEXT,
ADD COLUMN     "counselorKeyword" TEXT,
ADD COLUMN     "roomId" INTEGER,
ALTER COLUMN "timeStart" DROP NOT NULL,
ALTER COLUMN "timeEnd" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "pswHash";

-- DropTable
DROP TABLE "Admin";

-- DropTable
DROP TABLE "Student";

-- CreateTable
CREATE TABLE "Client" (
    "userId" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "major" TEXT,
    "department" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Room" (
    "roomId" SERIAL NOT NULL,
    "roomName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("roomId")
);

-- CreateTable
CREATE TABLE "SessionHistory" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "editedBy" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_clientId_key" ON "Client"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_roomName_key" ON "Room"("roomName");

-- CreateIndex
CREATE UNIQUE INDEX "Case_queueToken_key" ON "Case"("queueToken");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("clientId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("roomId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionHistory" ADD CONSTRAINT "SessionHistory_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("sessionId") ON DELETE RESTRICT ON UPDATE CASCADE;
