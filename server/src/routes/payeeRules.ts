import { Router } from "express";
import { z } from "zod";
import { Prisma, Role, TransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";
import { assertEncryptionPolicy, maybeEncryptedText } from "../lib/encryption";

// Payee → category (or family transfer) rules, nested under /api/families/:familyId/payee-rules. The server only stores
// them: matching happens on the device (SMS import, the transaction form), since the payee may be
// ciphertext here.
export const payeeRulesRouter = Router({ mergeParams: true });
payeeRulesRouter.use(requireAuth);

const RULE_INCLUDE = {
  category: { select: { id: true, name: true, color: true, icon: true, type: true } },
} satisfies Prisma.PayeeRuleInclude;

type RuleWithCategory = Prisma.PayeeRuleGetPayload<{ include: typeof RULE_INCLUDE }>;

function serializeRule(r: RuleWithCategory) {
  return {
    id: r.id,
    familyId: r.familyId,
    createdById: r.createdById,
    payee: r.payee,
    type: r.type,
    categoryId: r.categoryId,
    familyTransfer: r.familyTransfer,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    category: r.category,
  };
}

const typeSchema = z.enum([TransactionType.INCOME, TransactionType.EXPENSE]);

const fieldsSchema = z.object({
  payee: maybeEncryptedText(200, 2048).pipe(z.string().min(1, "Enter the payee text to match")),
  type: typeSchema,
  categoryId: z.string().min(1).nullable().optional(),
  // Money to or from family: left out of income and spending (with or without a category).
  familyTransfer: z.boolean().optional(),
});

const createSchema = fieldsSchema;
const updateSchema = fieldsSchema.partial();

function assertHasTarget(categoryId: string | null, familyTransfer: boolean) {
  if (!categoryId && !familyTransfer) throw new AppError(400, "Pick a category, or mark these as family transfers");
}

/** The category must be live, this family's, visible to the requester, and of the rule's type. */
async function assertCategory(familyId: string, requesterId: string, categoryId: string, type: TransactionType) {
  const category = await prisma.category.findFirst({ where: { id: categoryId, familyId, isArchived: false } });
  if (!category) throw new AppError(404, "Category not found");
  if (category.ownerId !== null && category.ownerId !== requesterId) {
    throw new AppError(403, "Cannot use another member's private category");
  }
  if (category.type !== type) throw new AppError(400, "Category type does not match");
}

// Rules pointing at someone else's private category (or an archived one) aren't theirs to see, or to apply.
function visibleTo(requesterId: string): Prisma.PayeeRuleWhereInput {
  return {
    OR: [{ categoryId: null }, { category: { isArchived: false, OR: [{ ownerId: null }, { ownerId: requesterId }] } }],
  };
}

payeeRulesRouter.get(
  "/",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const rules = await prisma.payeeRule.findMany({
      where: { familyId: req.params.familyId, ...visibleTo(req.user!.id) },
      include: RULE_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    res.json(rules.map(serializeRule));
  })
);

payeeRulesRouter.post(
  "/",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const data = createSchema.parse(req.body);
    const categoryId = data.categoryId ?? null;
    const familyTransfer = data.familyTransfer ?? false;
    assertHasTarget(categoryId, familyTransfer);
    await assertEncryptionPolicy(familyId, { payee: data.payee });
    if (categoryId) await assertCategory(familyId, requesterId, categoryId, data.type);

    const rule = await prisma.payeeRule.create({
      data: { familyId, createdById: requesterId, payee: data.payee, type: data.type, categoryId, familyTransfer },
      include: RULE_INCLUDE,
    });
    res.status(201).json(serializeRule(rule));
  })
);

payeeRulesRouter.patch(
  "/:ruleId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const existing = await prisma.payeeRule.findFirst({
      where: { id: req.params.ruleId, familyId, ...visibleTo(requesterId) },
    });
    if (!existing) throw new AppError(404, "Rule not found");

    const data = updateSchema.parse(req.body);
    await assertEncryptionPolicy(familyId, { payee: data.payee });
    const type = data.type ?? existing.type;
    const categoryId = data.categoryId !== undefined ? data.categoryId : existing.categoryId;
    const familyTransfer = data.familyTransfer ?? existing.familyTransfer;
    assertHasTarget(categoryId, familyTransfer);
    if (categoryId && (data.type || data.categoryId)) await assertCategory(familyId, requesterId, categoryId, type);

    const rule = await prisma.payeeRule.update({
      where: { id: existing.id },
      data: { payee: data.payee, type, categoryId, familyTransfer },
      include: RULE_INCLUDE,
    });
    res.json(serializeRule(rule));
  })
);

payeeRulesRouter.delete(
  "/:ruleId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const existing = await prisma.payeeRule.findFirst({
      where: { id: req.params.ruleId, familyId, ...visibleTo(req.user!.id) },
    });
    if (!existing) throw new AppError(404, "Rule not found");
    await prisma.payeeRule.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);
