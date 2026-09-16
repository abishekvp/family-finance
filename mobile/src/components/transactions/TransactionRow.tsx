import { Pressable, Text, View } from "react-native";
import type { Transaction } from "../../api/types";
import { colors } from "../../components/ui";
import { formatCurrency, initials } from "../../lib/format";

function formatDate(dateStr: string) {
  return dateStr.slice(0, 10);
}

export function CategoryBadge({
  color,
  label,
  size = 36,
}: {
  color: string;
  label: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.white, fontWeight: "700", fontSize: size * 0.4 }}>{label}</Text>
    </View>
  );
}

export function TransactionRow({ transaction, onPress }: { transaction: Transaction; onPress?: () => void }) {
  const t = transaction;
  const isTransfer = t.type === "TRANSFER";
  const badgeColor = isTransfer ? colors.slate400 : t.category?.color ?? colors.slate400;
  const badgeLabel = isTransfer ? "⇄" : initials(t.category?.name ?? "Uncategorized");
  const description = t.payee || t.category?.name || (isTransfer ? "Transfer" : "Uncategorized");
  const amountColor = isTransfer ? colors.slate700 : t.type === "INCOME" ? colors.green600 : colors.red600;
  const amountSign = isTransfer ? "" : t.type === "INCOME" ? "+" : "-";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
        pressed && onPress ? { opacity: 0.6 } : null,
      ]}
    >
      <CategoryBadge color={badgeColor} label={badgeLabel} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "600" }} numberOfLines={1}>
          {description}
        </Text>
        <Text style={{ color: colors.slate500, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
          {formatDate(t.date)} · {t.account.name}
          {isTransfer && t.transferToAccount ? ` → ${t.transferToAccount.name}` : ""}
        </Text>
      </View>
      <Text style={{ fontWeight: "700", color: amountColor }}>
        {amountSign}
        {formatCurrency(t.amount, t.account.currency)}
      </Text>
    </Pressable>
  );
}
