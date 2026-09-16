import { Stack } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import { PrefsProvider } from "../../src/context/PrefsContext";

export default function AppLayout() {
  const { user } = useAuth();
  const hasFamily = (user?.families.length ?? 0) > 0;

  return (
    <PrefsProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={hasFamily}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="family" options={{ headerShown: true, title: "Family" }} />
          <Stack.Screen name="settings" options={{ headerShown: true, title: "Settings" }} />
          <Stack.Screen name="categories" options={{ headerShown: true, title: "Categories" }} />
          <Stack.Screen name="budgets" options={{ headerShown: true, title: "Budgets" }} />
          <Stack.Screen
            name="transaction-form"
            options={{ presentation: "modal", headerShown: true, title: "Transaction" }}
          />
        </Stack.Protected>

        <Stack.Protected guard={!hasFamily}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
      </Stack>
    </PrefsProvider>
  );
}
