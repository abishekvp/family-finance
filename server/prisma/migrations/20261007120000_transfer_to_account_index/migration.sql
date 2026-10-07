-- Balance recalculation sums the transfers into an account on every save; without this it scanned
-- every family's transactions.
CREATE INDEX "Transaction_transferToAccountId_idx" ON "Transaction"("transferToAccountId");
