-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "repaysId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_repaysId_idx" ON "Transaction"("repaysId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_repaysId_fkey" FOREIGN KEY ("repaysId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

