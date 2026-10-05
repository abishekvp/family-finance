import { api } from "../api/client";
import type { Transaction } from "../api/types";
import { clearTodaySnapshot, setTodaySnapshot, type TodayWidgetItem } from "../../modules/home-widgets";
import { localDateInput } from "./dateUtils";
import { formatCurrency } from "./format";
import { totalsContribution } from "./transactionTotals";

interface Job {
  familyId: string;
  currency: string;
}

let queued: Job | null = null;
let running: Promise<void> | null = null;
// Bumped on sign-out so a refresh already in flight can't repopulate the widget afterwards.
let generation = 0;

function toItem(t: Transaction): TodayWidgetItem {
  const isTransfer = t.type === "TRANSFER";
  const amount = formatCurrency(t.amount, t.account.currency);
  return {
    title: t.payee || t.category?.name || (isTransfer ? "Transfer" : "Uncategorized"),
    subtitle: isTransfer
      ? `${t.account.name}${t.transferToAccount ? ` → ${t.transferToAccount.name}` : ""}`
      : [t.payee ? t.category?.name : null, t.account.name].filter(Boolean).join(" · "),
    amount: t.type === "EXPENSE" ? `−${amount}` : t.type === "INCOME" ? `+${amount}` : amount,
    kind: t.type,
  };
}

async function build({ familyId, currency }: Job) {
  const startGeneration = generation;
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const res = await api.get<Transaction[]>(`/families/${familyId}/transactions`, {
    params: { from: from.toISOString(), to: to.toISOString(), limit: 200 },
  });

  let spent = 0;
  let income = 0;
  for (const t of res.data) {
    const counted = totalsContribution(t);
    spent += counted.expense;
    income += counted.income;
  }

  if (generation !== startGeneration) return;
  await setTodaySnapshot({
    day: localDateInput(from),
    spent: formatCurrency(spent, currency),
    income: formatCurrency(income, currency),
    zero: formatCurrency(0, currency),
    items: res.data.map(toItem),
  });
}

/**
 * Rebuilds the "Today" home-screen widget from the server. The widget can't fetch on its own —
 * payees are end-to-end encrypted and only the app holds the key — so the app pushes a snapshot
 * whenever today's transactions may have changed. Calls made while one is running collapse into
 * a single follow-up run. Best effort: a failure leaves the previous snapshot in place.
 */
export function refreshTodayWidget(familyId: string, currency: string): Promise<void> {
  queued = { familyId, currency };
  running ??= (async () => {
    try {
      while (queued) {
        const job = queued;
        queued = null;
        await build(job).catch(() => undefined);
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Empties the widget — on sign-out, so a signed-out phone shows no finances on its home screen. */
export function clearTodayWidget() {
  generation += 1;
  queued = null;
  clearTodaySnapshot().catch(() => undefined);
}
