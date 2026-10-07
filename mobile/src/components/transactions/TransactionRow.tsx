import { Pressable, Text, View } from "react-native";
import { ArrowLeftRight, HandCoins } from "lucide-react-native";
import type { Transaction } from "../../api/types";
import { useTheme } from "../../context/ThemeContext";
import { Money } from "../ui";
import { initials } from "../../lib/format";
import { formatTime } from "../../lib/dateUtils";
import { isFamilyTransfer, isNotCounted } from "../../lib/transactionTotals";
import { isWriteOff, lendingFlow } from "../../lib/lending";

const NO_PEOPLE: ReadonlySet<string> = new Set();

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CategoryBadge({ color, label, size = 38 }: { color: string; label: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: size * 0.4 }}>{label}</Text>
    </View>
  );
}

function isFullyRefunded(t: Transaction) {
  return (t.refundedAmount ?? t.amount) >= t.amount - 0.005;
}

/**
 * One transaction. In a list already grouped by day (`showDate` off) it shows the time of day; on
 * its own, the date and time. Lend & borrow entries carry a sign — they move your account's balance —
 * but no income/spending colour, since they're neither.
 */
export function TransactionRow({
  transaction,
  onPress,
  people = NO_PEOPLE,
  showDate = false,
}: {
  transaction: Transaction;
  onPress?: () => void;
  /** Ids of the family's lend & borrow people, so entries with them read as lending. */
  people?: ReadonlySet<string>;
  showDate?: boolean;
}) {
  const { colors } = useTheme();
  const t = transaction;
  const isTransfer = t.type === "TRANSFER";
  const flow = lendingFlow(t, people);
  const isLending = flow !== null;
  const fromFamily = isFamilyTransfer(t);
  const writtenOff = isWriteOff(t);
  const uncounted = fromFamily || isNotCounted(t);
  const badgeColor = isTransfer ? colors.surfaceSunken : t.category?.color ?? colors.inkSubtle;
  const description = t.payee || t.category?.name || (isTransfer ? "Transfer" : fromFamily ? "Family transfer" : "Uncategorized");
  const displayAmount = isLending ? flow : t.type === "EXPENSE" ? -t.amount : t.amount;
  const when = showDate ? `${formatDate(t.date)}, ${formatTime(t.date)}` : formatTime(t.date);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderRadius: 12 },
        pressed && onPress ? { backgroundColor: colors.surfaceSunken } : null,
      ]}
    >
      {isTransfer || writtenOff ? (
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: isLending || writtenOff ? colors.brandSoft : badgeColor,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isLending || writtenOff ? <HandCoins size={16} color={colors.brand600} /> : <ArrowLeftRight size={16} color={colors.inkMuted} />}
        </View>
      ) : (
        <CategoryBadge color={badgeColor} label={initials(description)} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: "700", color: colors.ink }} numberOfLines={1}>
          {description}
        </Text>
        <Text style={{ color: colors.inkSubtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
          {when} · {t.account.name}
          {isTransfer && t.transferToAccount ? ` → ${t.transferToAccount.name}` : ""}
          {isLending ? " · Lend & borrow" : ""}
          {fromFamily ? (t.type === "INCOME" ? " · From family" : " · To family") : ""}
          {writtenOff ? " · Written off" : !fromFamily && uncounted ? " · Not counted" : ""}
          {t.recurringId ? " · Repeating" : ""}
          {t.refundsId ? (t.type === "INCOME" ? " · Refund" : " · Returned") : ""}
          {!t.refundsId && t.isRefunded ? (isFullyRefunded(t) ? " · Refunded" : " · Part refunded") : ""}
        </Text>
      </View>
      <Money
        amount={displayAmount}
        currency={t.account.currency}
        tone={isTransfer || uncounted ? undefined : t.type === "INCOME" ? "income" : "expense"}
        signed={!isTransfer || isLending}
        style={{ fontWeight: "800", fontSize: 14, ...(uncounted || isLending ? { color: colors.inkMuted } : null) }}
      />
    </Pressable>
  );
}
