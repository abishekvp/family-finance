import { Prisma } from "@prisma/client";

/**
 * Who sees and who uses an account:
 *  - a family account (ownerId null): everyone sees it and records on it;
 *  - a personal account: only its owner — unless they share it with the family, which lets everyone
 *    see it and its transactions (read-only, for the family's view of its money) and transfer money
 *    into it. Only the owner ever records on it.
 */
type AccountAccess = { ownerId: string | null; sharedWithFamily?: boolean | null };

/** Accounts the requester records on: family accounts and their own. */
export const USABLE_BY = (userId: string): Prisma.AccountWhereInput => ({ OR: [{ ownerId: null }, { ownerId: userId }] });

/** Accounts the requester sees: the usable ones plus those other members share with the family. */
export const SEEN_BY = (userId: string): Prisma.AccountWhereInput => ({
  OR: [{ ownerId: null }, { ownerId: userId }, { sharedWithFamily: true }],
});

export function canUseAccount(account: AccountAccess, userId: string) {
  return account.ownerId === null || account.ownerId === userId;
}

export function canSeeAccount(account: AccountAccess, userId: string) {
  return canUseAccount(account, userId) || !!account.sharedWithFamily;
}

/** An account another member shared with the family: something to look at or transfer money into. */
export function isSharedByOther(account: AccountAccess, userId: string) {
  return account.ownerId !== null && account.ownerId !== userId && !!account.sharedWithFamily;
}

/**
 * Transactions the requester sees: those on an account they see, and transfers into one — money a
 * member sent from their own private account to the family, or to you.
 */
export const TRANSACTION_SEEN_BY = (userId: string): Prisma.TransactionWhereInput => ({
  OR: [{ account: SEEN_BY(userId) }, { transferToAccount: SEEN_BY(userId) }],
});
