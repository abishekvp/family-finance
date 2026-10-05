import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type Tx = Prisma.TransactionClient;

/**
 * Options for every interactive transaction that writes transactions and recalculates balances.
 * Prisma's 5s default was too tight for a serverless function talking to a remote database (a cold
 * connection alone can take a second or two), which surfaced as 500s on save/edit.
 */
export const BALANCE_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

function uniqueIds(accountIds: (string | null | undefined)[]) {
  // Sorted, so concurrent requests always lock accounts in the same order and can't deadlock.
  return Array.from(new Set(accountIds.filter((id): id is string => !!id))).sort();
}

/**
 * Takes the balance locks for these accounts. Call it first thing inside the transaction, before
 * writing any transaction row: a write takes a key-share lock on its accounts (the foreign keys),
 * and taking the balance lock after that was what let two concurrent saves deadlock.
 *
 * FOR NO KEY UPDATE doesn't conflict with those foreign-key locks, only with other balance updates,
 * so recalculations of the same account run one after another.
 */
export async function lockAccounts(tx: Tx, accountIds: (string | null | undefined)[]) {
  const ids = uniqueIds(accountIds);
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "Account" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR NO KEY UPDATE`;
}

/**
 * Recomputes each account's balance from its opening balance and every approved, non-deleted
 * transaction on it — in one statement, whatever the number of accounts or transactions.
 *
 * Plain SQL on purpose: it leaves Account.updatedAt alone. The transaction sync feed's `scope`
 * changes whenever an account's updatedAt does, and bumping it on every save made every device
 * throw away its local copy and download all transactions again.
 */
export async function recalculateAccountBalances(tx: Tx, accountIds: (string | null | undefined)[]) {
  const ids = uniqueIds(accountIds);
  if (ids.length === 0) return;
  await lockAccounts(tx, ids);
  await tx.$executeRaw`
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
        ), 0)
    WHERE a.id IN (${Prisma.join(ids)})`;
}

/** Recalculates outside any caller transaction (after a write that already committed). */
export async function recalculateBalancesNow(accountIds: (string | null | undefined)[]) {
  const ids = uniqueIds(accountIds);
  if (ids.length === 0) return;
  await prisma.$transaction((tx) => recalculateAccountBalances(tx, ids), BALANCE_TX_OPTIONS);
}
