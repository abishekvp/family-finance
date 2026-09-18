import { Tabs } from "expo-router";
import { ArrowLeftRight, MoreHorizontal, PieChart, Wallet } from "lucide-react-native";
import { useTheme } from "../../../src/context/ThemeContext";

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.canvas },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.ink, fontWeight: "800" },
        tabBarActiveTintColor: colors.brand600,
        tabBarInactiveTintColor: colors.inkSubtle,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Transactions", tabBarIcon: ({ color, size }) => <ArrowLeftRight color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="stats"
        options={{ title: "Insights", tabBarIcon: ({ color, size }) => <PieChart color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="accounts"
        options={{ title: "Accounts", tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: "More", tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} /> }}
      />
    </Tabs>
  );
}
