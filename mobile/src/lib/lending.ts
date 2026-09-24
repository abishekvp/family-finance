import type { Account, Transaction } from "../api/types";
import { formatCurrency } from "./format";

/**
 * Lend & borrow: each friend or relative is a PERSON account whose balance is what they owe you
 * (positive) or what you owe them (negative). Money only ever moves to and from it as transfers,
 * so borrowed money never shows up as income and lent money never as an expense.
 */

/** "gave" moves money from one of your accounts to the person; "got" moves it the other way. */
export type LendingKind = "gave" | "got";

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

/** How a new entry changes the person's balance. */
export function balanceAfter(before: number, kind: LendingKind, amount: number) {
  return before + (kind === "gave" ? amount : -amount);
}

/**
 * The payee recorded on the transfer, so it reads well in the transaction list and the home-screen
 * widget. Giving money to someone you owe is paying them back; getting money from someone who owes
 * you is them paying you back.
 */
export function entryLabel(kind: LendingKind, before: number, name: string) {
  if (kind === "gave") return before < -EPSILON ? `Paid back ${name}` : `Lent to ${name}`;
  return before > EPSILON ? `${name} paid back` : `Borrowed from ${name}`;
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
