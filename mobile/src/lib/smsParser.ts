// Heuristic parser for bank / card / UPI transaction alerts. Deliberately conservative: a
// message is only treated as a transaction when it has both a debit/credit verb and an
// amount, and anything that reads like an OTP, a reminder, a request or a
// promotion is dropped — a missed alert is cheaper than a phantom transaction.

export interface ParsedSms {
  type: "INCOME" | "EXPENSE";
  amount: number;
  /** ISO code when the message names one, otherwise null. */
  currency: string | null;
  payee: string | null;
  /** Last digits of the account / card the alert is about, e.g. "1234". */
  accountHint: string | null;
}

const CURRENCY_CODES: Record<string, string> = {
  rs: "INR",
  "rs.": "INR",
  inr: "INR",
  "₹": "INR",
  usd: "USD",
  $: "USD",
  eur: "EUR",
  "€": "EUR",
  gbp: "GBP",
  "£": "GBP",
  aed: "AED",
  sgd: "SGD",
  cad: "CAD",
  aud: "AUD",
};

const AMOUNT_RE = /(rs\.?|inr|₹|usd|\$|eur|€|gbp|£|aed|sgd|cad|aud)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
// An amount straight after one of these is a balance or limit, not the transaction amount.
const BALANCE_PREFIX_RE = /(bal|balance|lmt|limit|avl|available|outstanding)[\s.:a-z]*$/i;

const DEBIT_RE = /\b(debited|debit|spent|withdrawn|withdrawal|paid|sent|purchase[d]?|deducted|charged|used for|txn of|transaction of|you made a|trf to)\b/i;
const CREDIT_RE = /\b(credited|received|deposited|refund(?:ed)?|added to|reversed)\b/i;

const SKIP_RES = [
  /\b(otp|one[- ]time password|verification code|passcode)\b/i,
  /\b(has requested|collect request|requested money|request money)\b/i,
  /\b(will be|to be|is scheduled to be) (debited|credited|deducted)\b/i,
  /\b(is|are|payment|amount|amt|total|minimum|min\.?)\s+due\b/i,
  /\bdue (on|by|date)\b/i,
  /\b(failed|declined|unsuccessful|could not be processed)\b/i,
  /\b(offer|congratulations|you have won|you won|eligible|pre-?approved|apply now)\b/i,
];

// Personal numbers (8+ digits) are people, not banks — banks use alphanumeric headers or short codes.
const PERSONAL_SENDER_RE = /^\+?\d{8,}$/;

function findAmount(body: string): { amount: number; currency: string | null } | null {
  for (const match of body.matchAll(AMOUNT_RE)) {
    const before = body.slice(Math.max(0, (match.index ?? 0) - 24), match.index);
    if (BALANCE_PREFIX_RE.test(before)) continue;
    const amount = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    return { amount: Math.round(amount * 100) / 100, currency: CURRENCY_CODES[match[1].toLowerCase()] ?? match[1].toUpperCase() };
  }
  // Some banks (SBI UPI alerts) omit the currency: "A/C X9876 debited by 120.0".
  const bare = body.match(/\b(?:debited|credited)\s+(?:by|with|for)\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i);
  const amount = bare ? Number(bare[1].replace(/,/g, "")) : NaN;
  return Number.isFinite(amount) && amount > 0 ? { amount: Math.round(amount * 100) / 100, currency: null } : null;
}

function findAccountHint(body: string): string | null {
  const masked = body.match(/[xX*]{2,}\s?([0-9]{3,6})\b/);
  if (masked) return masked[1].slice(-4);
  const labelled = body.match(/\b(?:a\/c|acct|account|card)\b[^0-9]{0,20}?([0-9]{3,6})\b/i);
  return labelled ? labelled[1].slice(-4) : null;
}

const PAYEE_CHARS = /[A-Za-z0-9@&'_/\-][A-Za-z0-9@&'._/\- ]{1,50}?/.source;
const PAYEE_STOP = /(?=\s+(?:on|via|ref|refno|ref no|using|for|from|to|with|dated|avl|txn|thru|through|if|not you)\b|[.,;:(?]|\s*$)/.source;
const payeeRe = (prefix: RegExp, suffix = PAYEE_STOP) => new RegExp(`${prefix.source}(${PAYEE_CHARS})${suffix}`, "gi");

// Tried in order; the first capture that survives cleanPayee wins.
const EXPENSE_PAYEE_RES = [
  payeeRe(/\bat\s+/),
  payeeRe(/\b(?:paid to|sent to|trf to|to|towards)\s+(?:vpa\s+)?/),
  payeeRe(/\bwith\s+/),
  // ICICI-style "…; AMAZON PAY credited."
  payeeRe(/;\s*/, /\s+credited\b/.source),
];
const INCOME_PAYEE_RES = [payeeRe(/\bfrom\s+(?:vpa\s+)?/), payeeRe(/\bby\s+(?:vpa\s+)?/)];
const INFO_PAYEE_RE = /\binfo[:\-\s]+([A-Za-z0-9@&'._/\- ]{2,40})/gi;

// Captures that are really about the user's own account, a payment rail, or an amount.
const NOT_A_PAYEE_RE = /^(a\/?c|acct|account|card|your|you|xx|\*|bank a\/c|ac\b|self|beneficiary|rs\b|rs\.|inr|usd|₹|\$|neft|imps|rtgs|upi|transfer|trf)\b/i;

function cleanPayee(raw: string | undefined): string | null {
  if (!raw) return null;
  // UPI-style paths ("UPI/P2A/4265/JOHN DOE") — the counterparty is the last wordy segment.
  const segment = raw.includes("/") ? [...raw.split("/")].reverse().find((part) => /[A-Za-z]{2,}/.test(part)) ?? "" : raw;
  const trimmed = segment.replace(/\s+/g, " ").trim().replace(/[-_.]+$/, "");
  if (trimmed.length < 2 || NOT_A_PAYEE_RE.test(trimmed) || /^[0-9xX*\s]+$/.test(trimmed)) return null;
  return trimmed.slice(0, 60);
}

function findPayee(body: string, type: ParsedSms["type"]): string | null {
  for (const re of [...(type === "EXPENSE" ? EXPENSE_PAYEE_RES : INCOME_PAYEE_RES), INFO_PAYEE_RE]) {
    for (const match of body.matchAll(re)) {
      const payee = cleanPayee(match[1]);
      if (payee) return payee;
    }
  }
  return null;
}

export function parseTransactionSms(address: string, body: string): ParsedSms | null {
  if (PERSONAL_SENDER_RE.test(address.replace(/[\s-]/g, ""))) return null;
  const text = body.replace(/\s+/g, " ").trim();
  if (!text || SKIP_RES.some((re) => re.test(text))) return null;

  // Alerts often mention both sides ("debited from A/c … and credited to VPA …"); the verb
  // that comes first describes what happened to the user's own account.
  const debitAt = text.search(DEBIT_RE);
  const creditAt = text.search(CREDIT_RE);
  if (debitAt < 0 && creditAt < 0) return null;
  const type: ParsedSms["type"] = creditAt < 0 || (debitAt >= 0 && debitAt < creditAt) ? "EXPENSE" : "INCOME";

  const amount = findAmount(text);
  if (!amount) return null;

  return {
    type,
    amount: amount.amount,
    currency: amount.currency,
    payee: findPayee(text, type),
    accountHint: findAccountHint(text),
  };
}
