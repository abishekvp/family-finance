-- Account.currentBalance has been in schema.prisma (and the production database) without a migration
-- creating it, so a fresh database couldn't run the app. IF NOT EXISTS keeps this a no-op where the
-- column is already there.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Recompute every balance once from its opening balance and approved, live transactions (the same
-- formula as lib/balances.ts). Balances could have drifted: repeating payments were recorded without
-- updating them, new accounts started at 0 instead of their opening balance, and editing an opening
-- balance didn't move the balance.
UPDATE "Account" a
SET "currentBalance" = a."openingBalance"
  + COALESCE((
      SELECT SUM(CASE WHEN t."type" = 'INCOME' THEN t."amount" ELSE -t."amount" END)
      FROM "Transaction" t
      WHERE t."accountId" = a.id AND t."isDeleted" = false AND t."approvalStatus" = 'APPROVED'
    ), 0)
  + COALESCE((
      SELECT SUM(t."amount")
      FROM "Transaction" t
      WHERE t."transferToAccountId" = a.id AND t."type" = 'TRANSFER' AND t."isDeleted" = false AND t."approvalStatus" = 'APPROVED'
    ), 0);
