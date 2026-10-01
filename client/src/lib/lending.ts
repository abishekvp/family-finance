import type { Account, Transaction } from "../api/types";
import { formatCurrency } from "./format";

/**
 * Lend & borrow, mirroring the mobile app: each friend or relative is a PERSON account, money moves
 * to and from it as transfers, and a return can be linked to the loan it pays back (repaysId).
 */

/** What an entry is, from your side. */
export type LendingKind = "lent" | "borrowed" | "got-back" | "paid-back";

export const LENDING_KIND_LABELS: Record<LendingKind, string> = {
  lent: "Lent",
  borrowed: "Borrowed",
  "got-back": "Got back",
  "paid-back": "Paid back",
};

const KIND_TAG_PREFIX = "lending:";

export function kindTag(kind: LendingKind) {
  return `${KIND_TAG_PREFIX}${kind}`;
}

export function withoutKindTag(tags: string[]) {
  return tags.filter((t) => !t.startsWith(KIND_TAG_PREFIX));
}

function parseKind(value: string | undefined | null): LendingKind | null {
  return value && value in LENDING_KIND_LABELS ? (value as LendingKind) : null;
}

export function moneyGoesOut(kind: LendingKind) {
  return kind === "lent" || kind === "paid-back";
}

// Amounts are cents-precise; anything smaller is floating-point noise, not a debt.
const EPSILON = 0.005;

export function isPerson(account: Pick<Account, "type">) {
  return account.type === "PERSON";
}

/** The payee recorded on the transfer, so it reads well in the transaction list. */
export function entryLabel(kind: LendingKind, name: string) {
  switch (kind) {
    case "lent":
      return `Lent to ${name}`;
    case "borrowed":
      return `Borrowed from ${name}`;
    case "got-back":
      return `${name} paid back`;
    case "paid-back":
      return `Paid back ${name}`;
  }
}

/** The kind of an existing transfer with a person (tag first, then the older label/direction rules). */
export function kindOf(t: Transaction, personId: string): LendingKind {
  const tagged = t.tags.find((tag) => tag.startsWith(KIND_TAG_PREFIX));
  const parsed = parseKind(tagged?.slice(KIND_TAG_PREFIX.length));
  if (parsed) return parsed;
  const out = t.transferToAccountId === personId;
  const payee = t.payee ?? "";
  if (out) return /^Paid back /.test(payee) ? "paid-back" : "lent";
  return / paid back$/.test(payee) ? "got-back" : "borrowed";
}

/** How an entry changes the person's balance: positive means they owe you more. */
function effectOf(t: Transaction, personId: string): number {
  if (t.type === "TRANSFER") return t.transferToAccountId === personId ? t.amount : -t.amount;
  // They paid for something of yours (expense: you owe them) or received something for you (income).
  return t.type === "EXPENSE" ? -t.amount : t.amount;
}

/** The loans a return of this kind pays back: "got back" returns what you lent, "paid back" what you borrowed. */
export function repaidDirection(kind: LendingKind): Loan["direction"] | null {
  if (kind === "got-back") return "lent";
  if (kind === "paid-back") return "borrowed";
  return null;
}

export interface Repayment {
  transaction: Transaction;
  /** The part of the entry that went to this loan. */
  amount: number;
}

export interface Loan {
  /** The entry that started it; null for an opening balance. */
  transaction: Transaction | null;
  /** What came back, oldest first. */
  repayments: Repayment[];
  /** "lent": they owe you. "borrowed": you owe them. */
  direction: "lent" | "borrowed";
  date: Date;
  amount: number;
  returned: number;
  remaining: number;
  dueDate: Date | null;
  settled: boolean;
  overdue: boolean;
}

function chronological(a: Transaction, b: Transaction) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * Splits a person's history into loans and how much of each has come back. Walking the entries in
 * date order, money moving one way first repays the loan it was linked to (see Transaction.repaysId),
 * then the oldest open loans in the other direction, and only the rest starts a new loan, so the
 * loans always add up to the person's balance.
 */
export function trackLoans(history: Transaction[], person: Pick<Account, "id" | "openingBalance" | "createdAt">, now = new Date()): Loan[] {
  const loans: Loan[] = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  function apply(effect: number, transaction: Transaction | null, date: Date) {
    let rest = Math.abs(effect);
    // Positive effect (money to them) first returns what you borrowed; negative returns what they borrowed.
    const repaying = effect > 0 ? "borrowed" : "lent";
    const linked = transaction?.repaysId ? loans.find((l) => l.transaction?.id === transaction.repaysId) : undefined;
    const order = linked ? [linked, ...loans.filter((l) => l !== linked)] : loans;
    for (const loan of order) {
      if (rest < EPSILON) break;
      if (loan.direction !== repaying || loan.remaining < EPSILON) continue;
      const part = Math.min(rest, loan.remaining);
      loan.returned += part;
      loan.remaining -= part;
      rest -= part;
      if (transaction) loan.repayments.push({ transaction, amount: part });
    }
    if (rest >= EPSILON) {
      loans.push({
        transaction,
        repayments: [],
        direction: effect > 0 ? "lent" : "borrowed",
        date,
        amount: rest,
        returned: 0,
        remaining: rest,
        dueDate: transaction?.dueDate ? new Date(transaction.dueDate) : null,
        settled: false,
        overdue: false,
      });
    }
  }

  const opening = Number(person.openingBalance) || 0;
  if (Math.abs(opening) >= EPSILON) apply(opening, null, new Date(person.createdAt));
  for (const t of [...history].sort(chronological)) {
    apply(effectOf(t, person.id), t, new Date(t.date));
  }

  for (const loan of loans) {
    loan.settled = loan.remaining < EPSILON;
    if (loan.settled) loan.remaining = 0;
    loan.overdue = !loan.settled && !!loan.dueDate && loan.dueDate < today;
  }
  return loans;
}

function shortDay(date: Date) {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "Lent ₹2,000 on 12 Sep · ₹1,500 left", for choosing which loan a return pays back. */
export function loanLabel(loan: Loan, currency: string) {
  const what = `${loan.direction === "lent" ? "Lent" : "Borrowed"} ${formatCurrency(loan.amount, currency)} on ${shortDay(loan.date)}`;
  return loan.returned > EPSILON ? `${what} · ${formatCurrency(loan.remaining, currency)} left` : what;
}
