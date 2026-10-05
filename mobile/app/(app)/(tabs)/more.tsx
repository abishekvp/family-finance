import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, HandCoins, LogOut, type LucideIcon, MessageSquareText, Repeat, PiggyBank, Settings as SettingsIcon, ShieldCheck, Tag, Target, Users, Wand2 } from "lucide-react-native";
import { useAuth } from "../../../src/context/AuthContext";
import { useTheme } from "../../../src/context/ThemeContext";
import { Avatar, Button, Card } from "../../../src/components/ui";
import { href } from "../../../src/lib/nav";
import { ThemePicker } from "../../../src/components/ThemePicker";

const MENU_ITEMS: { path: string; label: string; hint: string; icon: LucideIcon }[] = [
  { path: "/family", label: "Family", hint: "Members, roles, and invites", icon: Users },
  { path: "/account", label: "Account & security", hint: "Profile, email, passkeys, app lock, encryption", icon: ShieldCheck },
  { path: "/settings", label: "Settings", hint: "Currency, defaults, and preferences", icon: SettingsIcon },
  { path: "/categories", label: "Categories", hint: "Manage income and expense categories", icon: Tag },
  { path: "/payee-rules", label: "Payee rules", hint: "File transactions automatically by payee", icon: Wand2 },
  { path: "/budgets", label: "Budgets", hint: "Monthly and yearly budgets", icon: PiggyBank },
  { path: "/recurring", label: "Repeating payments", hint: "Salaries, rent and subscriptions", icon: Repeat },
  { path: "/goals", label: "Goals", hint: "Save toward a target, together", icon: Target },
  { path: "/lending", label: "Lend & borrow", hint: "Money lent to or borrowed from friends", icon: HandCoins },
  // Reading SMS is Android-only.
  ...(Platform.OS === "android"
    ? [{ path: "/sms-import", label: "SMS transactions", hint: "Record bank and card alerts automatically", icon: MessageSquareText }]
    : []),
];

export default function More() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { colors } = useTheme();

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar name={user?.name ?? "?"} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "800", fontSize: 15, color: colors.ink }}>{user?.name}</Text>
          <Text style={{ color: colors.inkSubtle, fontSize: 12, marginTop: 1 }}>{user?.email}</Text>
        </View>
      </Card>

      <Card style={{ padding: 0 }}>
        {MENU_ITEMS.map((item, i) => {
          const Icon = item.icon;
          return (
            <Pressable
              key={item.path}
              onPress={() => router.push(href(item.path))}
              style={({ pressed }) => [
                { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line },
                pressed && { backgroundColor: colors.surfaceSunken },
              ]}
            >
              <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
                <Icon size={16} color={colors.brand600} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", fontSize: 14.5, color: colors.ink }}>{item.label}</Text>
                <Text style={{ color: colors.inkSubtle, fontSize: 11.5, marginTop: 1 }}>{item.hint}</Text>
              </View>
              <ChevronRight size={17} color={colors.inkSubtle} />
            </Pressable>
          );
        })}
      </Card>

      <Card>
        <Text style={{ fontSize: 12, fontWeight: "700", color: colors.inkMuted, marginBottom: 10, textTransform: "uppercase" }}>Appearance</Text>
        <ThemePicker />
      </Card>

      <Button title="Sign out" variant="secondary" icon={<LogOut size={16} color={colors.ink} />} onPress={() => logout()} />
    </ScrollView>
  );
}
