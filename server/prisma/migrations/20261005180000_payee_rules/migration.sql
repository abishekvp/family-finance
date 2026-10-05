-- CreateTable
CREATE TABLE "PayeeRule" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "createdById" TEXT,
    "payee" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "categoryId" TEXT,
    "familyTransfer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayeeRule_familyId_idx" ON "PayeeRule"("familyId");

-- CreateIndex
CREATE INDEX "PayeeRule_categoryId_idx" ON "PayeeRule"("categoryId");

-- AddForeignKey
ALTER TABLE "PayeeRule" ADD CONSTRAINT "PayeeRule_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayeeRule" ADD CONSTRAINT "PayeeRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayeeRule" ADD CONSTRAINT "PayeeRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
