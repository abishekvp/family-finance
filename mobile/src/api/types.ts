// Shared TS interfaces mirroring the server's JSON response shapes exactly.
// See the SHARED CONTRACT for the authoritative field list — do not invent fields here.

export type AccountType = "CASH" | "BANK" | "SAVINGS" | "CREDIT_CARD" | "DEBIT_CARD" | "INVESTMENT" | "LOAN" | "PERSON";
export type CategoryType = "INCOME" | "EXPENSE";
export type TransactionType = "INCOME" | "EXPENSE" | "TRANSFER";
export type TransactionStatus = "PENDING" | "CLEARED";
export type BudgetPeriod = "MONTHLY" | "WEEKLY" | "ANNUAL";
export type FamilyRole = "ADMIN" | "MEMBER" | "VIEWER";

export interface Account {
  id: string;
  familyId: string;
  ownerId: string | null;
  name: string;
  type: AccountType;
  currency: string;
  // NOTE: these two come straight off the Prisma row (not explicitly Number()-cast by the
  // existing GET /accounts handler), so they may arrive as numeric strings. Always read them
  // through Number(...) rather than relying on the static type.
  openingBalance: number;
  creditLimit: number | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string } | null;
  // Computed by the server: openingBalance + all non-deleted transaction effects.
  balance: number;
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
  dueDate: string | null;
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
  period: BudgetPeriod;
  amount: number;
  month: number | null;
  year: number;
  rollover: boolean;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string; color: string; icon: string; type: CategoryType };
  spent: number;
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
