import { Pressable, Text, View } from "react-native";
import { ArrowLeftRight } from "lucide-react-native";
import type { Transaction } from "../../api/types";
import { useTheme } from "../../context/ThemeContext";
import { Money } from "../ui";
import { initials } from "../../lib/format";

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

export function TransactionRow({ transaction, onPress }: { transaction: Transaction; onPress?: () => void }) {
  const { colors } = useTheme();
  const t = transaction;
  const isTransfer = t.type === "TRANSFER";
  const badgeColor = isTransfer ? colors.surfaceSunken : t.category?.color ?? colors.inkSubtle;
  const description = t.payee || t.category?.name || (isTransfer ? "Transfer" : "Uncategorized");
  const displayAmount = t.type === "EXPENSE" ? -t.amount : t.amount;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderRadius: 12 },
        pressed && onPress ? { backgroundColor: colors.surfaceSunken } : null,
      ]}
    >
      {isTransfer ? (
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: badgeColor,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ArrowLeftRight size={16} color={colors.inkMuted} />
        </View>
      ) : (
        <CategoryBadge color={badgeColor} label={initials(description)} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: "700", color: colors.ink }} numberOfLines={1}>
          {description}
        </Text>
        <Text style={{ color: colors.inkSubtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
          {formatDate(t.date)} · {t.account.name}
          {isTransfer && t.transferToAccount ? ` → ${t.transferToAccount.name}` : ""}
        </Text>
      </View>
      <Money
        amount={displayAmount}
        currency={t.account.currency}
        tone={isTransfer ? undefined : t.type === "INCOME" ? "income" : "expense"}
        signed={!isTransfer}
        style={{ fontWeight: "800", fontSize: 14 }}
      />
    </Pressable>
  );
}
