-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "refundsId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_refundsId_idx" ON "Transaction"("refundsId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_refundsId_fkey" FOREIGN KEY ("refundsId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
