import { prisma } from "./prisma";
import { COUNTED } from "./approval";

export async function recalculateAccountBalances(tx: any, accountIds: (string | null | undefined)[]) {
  const ids = Array.from(new Set(accountIds.filter(Boolean))) as string[];
  if (ids.length === 0) return;

  for (const accountId of ids) {
    // 1. Lock the account row so concurrent updates to this account wait
    await tx.$executeRaw`SELECT 1 FROM "Account" WHERE id = ${accountId} FOR UPDATE`;

    // 2. Fetch the account to get openingBalance
    const account = await tx.account.findUnique({
      where: { id: accountId },
      select: { openingBalance: true },
    });
    if (!account) continue;

    // 3. Aggregate outgoing (EXPENSE, INCOME, outgoing TRANSFER)
    const outgoingTx = await tx.transaction.findMany({
      where: { accountId: accountId, isDeleted: false, ...COUNTED },
      select: { type: true, amount: true },
    });

    const delta = outgoingTx.reduce((sum: number, t: any) => {
      return t.type === "INCOME" ? sum + Number(t.amount) : sum - Number(t.amount);
    }, 0);

    // 4. Aggregate incoming (incoming TRANSFER)
    const incoming = await tx.transaction.aggregate({
      where: { transferToAccountId: accountId, isDeleted: false, type: "TRANSFER", ...COUNTED },
      _sum: { amount: true },
    });
    const incomingTransferTotal = Number(incoming._sum.amount ?? 0);

    const currentBalance = Number(account.openingBalance) + delta + incomingTransferTotal;

    // 5. Update the currentBalance
    await tx.account.update({
      where: { id: accountId },
      data: { currentBalance },
    });
  }
}
