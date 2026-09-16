import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../../src/context/AuthContext";
import { Button, Card, colors } from "../../../src/components/ui";
import { href } from "../../../src/lib/nav";

const MENU_ITEMS: { path: string; label: string; hint: string }[] = [
  { path: "/family", label: "Family", hint: "Members, roles, and invites" },
  { path: "/settings", label: "Settings", hint: "Currency, defaults, and preferences" },
  { path: "/categories", label: "Categories", hint: "Manage income and expense categories" },
  { path: "/budgets", label: "Budgets", hint: "Set and track monthly budgets" },
];

export default function More() {
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <ScrollView style={{ backgroundColor: colors.slate50 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card style={{ gap: 2 }}>
        <Text style={{ fontWeight: "700", fontSize: 16 }}>{user?.name}</Text>
        <Text style={{ color: colors.slate500, fontSize: 13 }}>{user?.email}</Text>
      </Card>

      <Card style={{ padding: 0 }}>
        {MENU_ITEMS.map((item, i) => (
          <Pressable
            key={item.path}
            onPress={() => router.push(href(item.path))}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              padding: 16,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.slate200,
            }}
          >
            <View>
              <Text style={{ fontWeight: "600", fontSize: 15 }}>{item.label}</Text>
              <Text style={{ color: colors.slate500, fontSize: 12, marginTop: 2 }}>{item.hint}</Text>
            </View>
            <Text style={{ color: colors.slate400, fontSize: 18 }}>›</Text>
          </Pressable>
        ))}
      </Card>

      <Button title="Sign out" variant="secondary" onPress={() => logout()} />
    </ScrollView>
  );
}
