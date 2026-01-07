-- CreateTable
CREATE TABLE "User" (
    "userId" SERIAL NOT NULL,
    "cmuAccount" TEXT NOT NULL,
    "titleName" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "studentId" TEXT,
    "role" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AvailabilitySlot" (
    "slotId" SERIAL NOT NULL,
    "counselorId" INTEGER NOT NULL,
    "startDateTime" TIMESTAMP(3) NOT NULL,
    "endDateTime" TIMESTAMP(3) NOT NULL,
    "isBooked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY ("slotId")
);

-- CreateTable
CREATE TABLE "Booking" (
    "bookingId" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "slotId" INTEGER NOT NULL,
    "topic" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "googleEventId" TEXT,
    "meetLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "CaseNote" (
    "noteId" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "counselorId" INTEGER NOT NULL,
    "details" TEXT,
    "mentalScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("noteId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_cmuAccount_key" ON "User"("cmuAccount");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_slotId_key" ON "Booking"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseNote_bookingId_key" ON "CaseNote"("bookingId");

-- AddForeignKey
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "AvailabilitySlot_counselorId_fkey" FOREIGN KEY ("counselorId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "AvailabilitySlot"("slotId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("bookingId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_counselorId_fkey" FOREIGN KEY ("counselorId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
