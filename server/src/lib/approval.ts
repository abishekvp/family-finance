import { ApprovalStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Only approved transactions count toward balances, budgets and totals. Pending and rejected ones
 * are kept (nothing a member records is lost) but left out until an admin approves them.
 */
export const COUNTED: Prisma.TransactionWhereInput = { approvalStatus: ApprovalStatus.APPROVED };

/**
 * The approval state a transaction recorded by this user starts in. With the family's approval
 * setting on, an entry touching a shared account waits for an admin unless an admin recorded it.
 * Entries that stay inside the member's own private accounts count straight away: admins can't see
 * those accounts, so nobody could approve them.
 */
export async function initialApprovalStatus(
  familyId: string,
  userId: string,
  accountIds: (string | null | undefined)[],
  role?: Role
): Promise<ApprovalStatus> {
  const family = await prisma.family.findUnique({ where: { id: familyId }, select: { requireApproval: true } });
  if (!family?.requireApproval) return ApprovalStatus.APPROVED;
  const memberRole =
    role ??
    (await prisma.familyMembership.findUnique({ where: { userId_familyId: { userId, familyId } }, select: { role: true } }))?.role;
  if (memberRole === Role.ADMIN) return ApprovalStatus.APPROVED;
  const ids = accountIds.filter((id): id is string => !!id);
  const shared = await prisma.account.count({ where: { id: { in: ids }, familyId, ownerId: null } });
  return shared > 0 ? ApprovalStatus.PENDING : ApprovalStatus.APPROVED;
}
