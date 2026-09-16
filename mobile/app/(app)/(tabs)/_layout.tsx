import { Tabs } from "expo-router";
import { colors } from "../../../src/components/ui";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: colors.brand600,
        tabBarInactiveTintColor: colors.slate400,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard" }} />
      <Tabs.Screen name="family" options={{ title: "Family" }} />
    </Tabs>
  );
}
