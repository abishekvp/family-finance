import type { Account, Transaction } from "../api/types";
import { formatCurrency } from "./format";

/**
 * Lend & borrow: each friend or relative is a PERSON account whose balance is what they owe you
 * (positive) or what you owe them (negative). Money only ever moves to and from it as transfers,
 * so borrowed money never shows up as income and lent money never as an expense.
 */

/**
 * What an entry is, from your side. "lent" and "paid-back" move money from your account to the
 * person; "borrowed" and "got-back" move it the other way.
 */
export type LendingKind = "lent" | "borrowed" | "got-back" | "paid-back";

export const LENDING_KINDS: { value: LendingKind; label: string; hint: string }[] = [
  { value: "lent", label: "Lent", hint: "You gave them money they'll return" },
  { value: "borrowed", label: "Borrowed", hint: "They gave you money you'll return" },
  { value: "got-back", label: "Got back", hint: "They returned money you lent" },
  { value: "paid-back", label: "Paid back", hint: "You returned money you borrowed" },
];

const KIND_TAG_PREFIX = "lending:";

export function kindTag(kind: LendingKind) {
  return `${KIND_TAG_PREFIX}${kind}`;
}

/** Tags without the lending kind, so a new one can be set (or none, when it stops being a loan). */
export function withoutKindTag(tags: string[]) {
  return tags.filter((t) => !t.startsWith(KIND_TAG_PREFIX));
}

export function parseKind(value: string | undefined | null): LendingKind | null {
  return LENDING_KINDS.some((k) => k.value === value) ? (value as LendingKind) : null;
}

export function moneyGoesOut(kind: LendingKind) {
  return kind === "lent" || kind === "paid-back";
}

/** Whether the entry starts a loan (and so can have a return-by date) rather than returning one. */
export function startsLoan(kind: LendingKind) {
  return kind === "lent" || kind === "borrowed";
}

// Amounts are cents-precise; anything smaller is floating-point noise, not a debt.
const EPSILON = 0.005;

export function isPerson(account: Pick<Account, "type">) {
  return account.type === "PERSON";
}

export function isSettled(balance: number) {
  return Math.abs(balance) < EPSILON;
}

/** Plain-language position with one person, e.g. "Ravi owes you ₹2,000". */
export function describeBalance(name: string, balance: number, currency: string) {
  if (isSettled(balance)) return "All settled up";
  const amount = formatCurrency(Math.abs(balance), currency);
  return balance > 0 ? `${name} owes you ${amount}` : `You owe ${name} ${amount}`;
}

/** Short status for list rows. */
export function balanceStatus(balance: number) {
  if (isSettled(balance)) return "Settled up";
  return balance > 0 ? "Owes you" : "You owe";
}

export function lendingTotals(people: Account[]) {
  let owedToYou = 0;
  let youOwe = 0;
  for (const p of people) {
    if (p.balance > 0) owedToYou += p.balance;
    else youOwe += -p.balance;
  }
  return { owedToYou, youOwe };
}

/** How an entry changes the person's balance: positive means they owe you more. */
export function balanceEffect(kind: LendingKind, amount: number) {
  return moneyGoesOut(kind) ? amount : -amount;
}

/** The payee recorded on the transfer, so it reads well in the transaction list and the widget. */
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

/**
 * The kind of an existing transfer with a person. Entries record it as a tag; older ones (made
 * before tags) are recognised by the label they were saved with, then by direction.
 */
export function kindOf(t: Transaction, personId: string): LendingKind {
  const tagged = t.tags.find((tag) => tag.startsWith(KIND_TAG_PREFIX));
  const parsed = parseKind(tagged?.slice(KIND_TAG_PREFIX.length));
  if (parsed) return parsed;
  const out = t.transferToAccountId === personId;
  const payee = t.payee ?? "";
  if (out) return /^Paid back /.test(payee) ? "paid-back" : "lent";
  return / paid back$/.test(payee) ? "got-back" : "borrowed";
}

/**
 * One line of a person's history, from your side: how it moved their balance (positive means they
 * owe you more) and where the money came from or went.
 */
export function describeEntry(t: Transaction, personId: string): { effect: number; label: string; detail: string } {
  if (t.type === "TRANSFER" && t.transferToAccountId === personId) {
    return { effect: t.amount, label: t.payee || "You gave", detail: `From ${t.account.name}` };
  }
  if (t.type === "TRANSFER") {
    return { effect: -t.amount, label: t.payee || "You got", detail: t.transferToAccount ? `Into ${t.transferToAccount.name}` : "" };
  }
  // They paid for something of yours: a real expense for you, and now you owe them for it.
  if (t.type === "EXPENSE") {
    return { effect: -t.amount, label: t.payee || "Paid for you", detail: t.category?.name ?? "Paid for you" };
  }
  return { effect: t.amount, label: t.payee || "Received for you", detail: t.category?.name ?? "Received for you" };
}

export interface Loan {
  /** The entry that started it; null for an opening balance. */
  transaction: Transaction | null;
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
 * date order, money moving one way first repays the oldest open loans in the other direction and
 * only the rest starts a new loan, so the loans always add up to the person's balance.
 */
export function trackLoans(history: Transaction[], person: Pick<Account, "id" | "openingBalance" | "createdAt">, now = new Date()): Loan[] {
  const loans: Loan[] = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  function apply(effect: number, transaction: Transaction | null, date: Date) {
    let rest = Math.abs(effect);
    // Positive effect (money to them) first returns what you borrowed; negative returns what they borrowed.
    const repaying = effect > 0 ? "borrowed" : "lent";
    for (const loan of loans) {
      if (rest < EPSILON) break;
      if (loan.direction !== repaying || loan.remaining < EPSILON) continue;
      const part = Math.min(rest, loan.remaining);
      loan.returned += part;
      loan.remaining -= part;
      rest -= part;
    }
    if (rest >= EPSILON) {
      loans.push({
        transaction,
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
  if (!isSettled(opening)) apply(opening, null, new Date(person.createdAt));
  for (const t of [...history].sort(chronological)) {
    apply(describeEntry(t, person.id).effect, t, new Date(t.date));
  }

  for (const loan of loans) {
    loan.settled = loan.remaining < EPSILON;
    if (loan.settled) loan.remaining = 0;
    loan.overdue = !loan.settled && !!loan.dueDate && loan.dueDate < today;
  }
  return loans;
}

/** The earliest return-by date among a person's open loans, and whether anything is overdue. */
export function nextDue(loans: Loan[]) {
  const open = loans.filter((l) => !l.settled && l.dueDate);
  const earliest = open.reduce<Date | null>((min, l) => (!min || l.dueDate! < min ? l.dueDate! : min), null);
  return { dueDate: earliest, overdue: open.some((l) => l.overdue) };
}
