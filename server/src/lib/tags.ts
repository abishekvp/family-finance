// Transaction tags with a meaning the server has to respect (mirrored in both apps'
// lib/transactionTotals.ts and lib/lending.ts).

/** An income or expense that is money to or from family: it moves the balance, but isn't income or spending. */
export const FAMILY_TRANSFER_TAG = "family-transfer";

/**
 * Closes money lent to (or borrowed from) a person that won't be returned: an expense (or income) posted
 * on the person's account, linked to the loan through `repaysId`.
 */
export const WRITE_OFF_TAG = "lending:written-off";

/** Moves a balance but never counts as income or spending, nor in budgets — e.g. a write-off kept out of spending. */
export const NOT_COUNTED_TAG = "not-counted";

/** Tags that keep an income or expense out of income, spending and budget totals. */
export const UNCOUNTED_TAGS = [FAMILY_TRANSFER_TAG, NOT_COUNTED_TAG];
