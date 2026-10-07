import type { Account, Transaction } from "../api/types";
import { formatCurrency } from "./format";
import { NOT_COUNTED_TAG, isNotCounted } from "./transactionTotals";

/**
 * Lend & borrow (shared with the mobile app's src/lib/lending.ts): each friend or relative is a PERSON
 * account whose balance is what they owe you
 * (positive) or what you owe them (negative). Money only ever moves to and from it as transfers,
 * so borrowed money never shows up as income and lent money never as an expense — while your own
 * account's balance moves by exactly what left or arrived.
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

/**
 * Money lent that won't come back (or borrowed money you no longer have to repay), closed off: an
 * expense (or income) on the person's own account, linked to the loan through `repaysId`. It takes
 * the amount off what they owe without touching your accounts — the money already left them. Tagged
 * NOT_COUNTED_TAG too unless it was chosen to count as spending (or income).
 */
export const WRITE_OFF_TAG = "lending:written-off";

export function kindTag(kind: LendingKind) {
  return `${KIND_TAG_PREFIX}${kind}`;
}

/** Tags without the lending kind, so a new one can be set (or none, when it stops being a loan). */
export function withoutKindTag(tags: string[]) {
  return tags.filter((t) => !LENDING_KINDS.some((k) => t === kindTag(k.value)));
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

export function isWriteOff(t: Pick<Transaction, "type" | "tags">) {
  return t.type !== "TRANSFER" && (t.tags ?? []).includes(WRITE_OFF_TAG);
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
    const balance = p.balance ?? 0;
    if (balance > 0) owedToYou += balance;
    else youOwe += -balance;
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

/** The payee recorded on a write-off. */
export function writeOffLabel(name: string) {
  return `Written off · ${name}`;
}

/**
 * For a lend & borrow entry, how it moved your own account: money going out to the person is
 * negative, money coming back from them positive. Null for anything that isn't one, so callers can
 * show it with a sign (it changes your balance) yet apart from income and spending (it isn't either).
 */
export function lendingFlow(t: Transaction, people: ReadonlySet<string>): number | null {
  if (t.type !== "TRANSFER") return null;
  const toPerson = !!t.transferToAccountId && people.has(t.transferToAccountId);
  const fromPerson = people.has(t.accountId);
  if (toPerson !== fromPerson) return toPerson ? -t.amount : t.amount;
  if (toPerson) return null;
  // With someone no longer listed (removed from Lend & borrow), the kind it was saved as tells the way.
  const kind = parseKind(t.tags.find((tag) => tag.startsWith(KIND_TAG_PREFIX))?.slice(KIND_TAG_PREFIX.length));
  return kind ? (moneyGoesOut(kind) ? -t.amount : t.amount) : null;
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
  if (isWriteOff(t)) {
    const counted = !isNotCounted(t);
    const detail = t.type === "EXPENSE" ? (counted ? "Counted as spending" : "Not counted as spending") : counted ? "Counted as income" : "Not counted as income";
    return { effect: t.type === "EXPENSE" ? -t.amount : t.amount, label: t.payee || "Written off", detail };
  }
  // They paid for something of yours: a real expense for you, and now you owe them for it.
  if (t.type === "EXPENSE") {
    return { effect: -t.amount, label: t.payee || "Paid for you", detail: t.category?.name ?? "Paid for you" };
  }
  return { effect: t.amount, label: t.payee || "Received for you", detail: t.category?.name ?? "Received for you" };
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
  /** Closed off as not coming back, rather than returned. */
  writtenOff: boolean;
}

export interface Loan {
  /** The entry that started it; null for an opening balance. */
  transaction: Transaction | null;
  /** What came back (or was written off), oldest first. */
  repayments: Repayment[];
  /** "lent": they owe you. "borrowed": you owe them. */
  direction: "lent" | "borrowed";
  date: Date;
  amount: number;
  returned: number;
  /** Closed off as not coming back. */
  writtenOff: number;
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
 * loans always add up to the person's balance. A write-off settles loans the same way, but counts as
 * written off rather than returned.
 */
export function trackLoans(history: Transaction[], person: Pick<Account, "id" | "openingBalance" | "createdAt">, now = new Date()): Loan[] {
  const loans: Loan[] = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  function apply(effect: number, transaction: Transaction | null, date: Date) {
    let rest = Math.abs(effect);
    const writtenOff = !!transaction && isWriteOff(transaction);
    // Positive effect (money to them) first returns what you borrowed; negative returns what they borrowed.
    const repaying = effect > 0 ? "borrowed" : "lent";
    const linked = transaction?.repaysId ? loans.find((l) => l.transaction?.id === transaction.repaysId) : undefined;
    const order = linked ? [linked, ...loans.filter((l) => l !== linked)] : loans;
    for (const loan of order) {
      if (rest < EPSILON) break;
      if (loan.direction !== repaying || loan.remaining < EPSILON) continue;
      const part = Math.min(rest, loan.remaining);
      if (writtenOff) loan.writtenOff += part;
      else loan.returned += part;
      loan.remaining -= part;
      rest -= part;
      if (transaction) loan.repayments.push({ transaction, amount: part, writtenOff });
    }
    if (rest >= EPSILON) {
      loans.push({
        transaction,
        repayments: [],
        direction: effect > 0 ? "lent" : "borrowed",
        date,
        amount: rest,
        returned: 0,
        writtenOff: 0,
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

function shortDay(date: Date) {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "Lent ₹2,000 on 12 Sep · ₹1,500 left", for choosing which loan a return pays back. */
export function loanLabel(loan: Loan, currency: string) {
  const what = `${loan.direction === "lent" ? "Lent" : "Borrowed"} ${formatCurrency(loan.amount, currency)} on ${shortDay(loan.date)}`;
  return loan.returned + loan.writtenOff > EPSILON ? `${what} · ${formatCurrency(loan.remaining, currency)} left` : what;
}

/** Where a loan stands: "₹500 returned · ₹200 written off", "₹300 left", "Fully returned". */
export function loanStatus(loan: Loan, currency: string) {
  const parts: string[] = [];
  if (loan.returned > EPSILON) parts.push(`${formatCurrency(loan.returned, currency)} returned`);
  if (loan.writtenOff > EPSILON) parts.push(`${formatCurrency(loan.writtenOff, currency)} written off`);
  if (loan.settled) return loan.writtenOff > EPSILON ? (loan.returned > EPSILON ? parts.join(" · ") : "Written off") : "Fully returned";
  return [...parts, `${formatCurrency(loan.remaining, currency)} left`].join(" · ");
}

/** The earliest return-by date among a person's open loans, and whether anything is overdue. */
export function nextDue(loans: Loan[]) {
  const open = loans.filter((l) => !l.settled && l.dueDate);
  const earliest = open.reduce<Date | null>((min, l) => (!min || l.dueDate! < min ? l.dueDate! : min), null);
  return { dueDate: earliest, overdue: open.some((l) => l.overdue) };
}

/**
 * The request body that closes (part of) a loan as not coming back. Money you lent becomes an
 * expense on the person, money you borrowed an income; either counts as spending (or income) only
 * when asked, under `categoryId`.
 */
export function writeOffPayload({
  person,
  loan,
  amount,
  date,
  counted,
  categoryId,
  notes,
}: {
  person: Pick<Account, "id" | "name">;
  loan: { direction: Loan["direction"]; transaction: Pick<Transaction, "id"> | null };
  amount: number;
  date: string;
  counted: boolean;
  categoryId: string | null;
  notes: string | null;
}) {
  return {
    type: loan.direction === "lent" ? "EXPENSE" : "INCOME",
    accountId: person.id,
    amount,
    date,
    categoryId: counted ? categoryId : null,
    payee: writeOffLabel(person.name),
    notes: notes?.trim() || null,
    repaysId: loan.transaction?.id ?? null,
    tags: counted ? [WRITE_OFF_TAG] : [WRITE_OFF_TAG, NOT_COUNTED_TAG],
  };
}

/**
 * A person's name, kept in the notes of each entry moved off them when they're merged into someone
 * else — e.g. "Ravi · dinner". Mirrors the server, which does this itself unless the notes are
 * end-to-end encrypted.
 */
export function withNameInNotes(name: string, notes: string | null) {
  const trimmed = notes?.trim() ?? "";
  if (trimmed === name || trimmed.startsWith(`${name} · `)) return trimmed;
  return (trimmed ? `${name} · ${trimmed}` : name).slice(0, 1000);
}
