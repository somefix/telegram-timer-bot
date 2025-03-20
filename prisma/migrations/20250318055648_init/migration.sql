-- CreateTable
CREATE TABLE "timers" (
    "id" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "chatId" BIGINT NOT NULL,
    "pinnedMessageId" INTEGER,
    "isRunning" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timers_pkey" PRIMARY KEY ("id")
);
