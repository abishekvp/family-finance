// Shared TS interfaces mirroring the server's JSON response shapes.
// Keep these in sync with the SHARED CONTRACT — do not invent alternate fields.

export const ACCOUNT_TYPES = [
  "CASH",
  "BANK",
  "SAVINGS",
  "CREDIT_CARD",
  "DEBIT_CARD",
  "INVESTMENT",
  "LOAN",
  "PERSON",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type CategoryType = "INCOME" | "EXPENSE";
export type TransactionType = "INCOME" | "EXPENSE" | "TRANSFER";
export type TransactionStatus = "PENDING" | "CLEARED";
/** Only APPROVED transactions count toward balances, budgets and totals. */
export type ApprovalStatus = "APPROVED" | "PENDING" | "REJECTED";
export type BudgetPeriod = "MONTHLY" | "WEEKLY" | "ANNUAL";
export type FamilyRole = "ADMIN" | "MEMBER" | "VIEWER";

export interface Account {
  id: string;
  familyId: string;
  ownerId: string | null;
  name: string;
  type: AccountType;
  currency: string;
  // Decimal fields from Prisma can arrive as numbers or numeric strings depending on the
  // route — always read them through Number(...) rather than assuming a numeric type.
  openingBalance: number | string;
  creditLimit: number | string | null;
  interestRate: number | string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isArchived: boolean;
  includeInNetWorth: boolean;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string } | null;
  // Computed by the server on GET /accounts; absent on the raw row returned by PATCH.
  balance?: number;
}

export interface Category {
  id: string;
  familyId: string;
  ownerId: string | null;
  parentId: string | null;
  name: string;
  type: CategoryType;
  color: string;
  icon: string;
  sortOrder: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  familyId: string;
  accountId: string;
  transferToAccountId: string | null;
  categoryId: string | null;
  userId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  date: string;
  payee: string | null;
  notes: string | null;
  tags: string[];
  /** When money lent to or borrowed from a person is expected back. */
  dueDate?: string | null;
  /** The repeating payment this was recorded from, if any. */
  recurringId?: string | null;
  approvalStatus?: ApprovalStatus;
  reviewedById?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  account: { id: string; name: string; currency: string };
  transferToAccount: { id: string; name: string } | null;
  category: { id: string; name: string; color: string; icon: string; type: CategoryType } | null;
}

export interface Budget {
  id: string;
  familyId: string;
  ownerId: string | null;
  categoryId: string;
  /** Its own name, when given; otherwise it goes by its category's. */
  name?: string | null;
  period: BudgetPeriod;
  amount: number;
  month: number | null;
  year: number;
  rollover: boolean;
  /** Carried into each new month (or year) when it starts. */
  repeats?: boolean;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string; color: string; icon: string; type: CategoryType };
  spent: number;
  /** Repeating payments in this category still to come in the period. */
  upcoming?: number;
  remaining: number;
}

export interface Goal {
  id: string;
  familyId: string;
  ownerId: string | null;
  accountId: string | null;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  isCompleted: boolean;
  createdAt: string;
  updatedAt: string;
  account: { id: string; name: string } | null;
  saved: number;
  remaining: number;
  progress: number;
}

export interface Family {
  id: string;
  name: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  role: FamilyRole;
}
