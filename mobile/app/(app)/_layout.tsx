import { Stack } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import { PrefsProvider } from "../../src/context/PrefsContext";
import { SmsImportProvider } from "../../src/context/SmsImportContext";
import { useTheme } from "../../src/context/ThemeContext";
import { SecurityGate } from "../../src/components/SecurityGate";
import { TodayWidgetSync } from "../../src/components/TodayWidgetSync";
import { RecurringSync } from "../../src/components/RecurringSync";

// A screen opened straight from a deep link (a home-screen widget's quick add) still gets the
// tabs underneath it, so going back lands on the transactions list instead of leaving the app.
export const unstable_settings = { initialRouteName: "(tabs)" };

export default function AppLayout() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const hasFamily = (user?.families.length ?? 0) > 0;

  return (
    <SecurityGate>
      <PrefsProvider>
        <SmsImportProvider>
          {hasFamily && <TodayWidgetSync />}
          {hasFamily && <RecurringSync />}
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.canvas },
              headerStyle: { backgroundColor: colors.canvas },
              headerTintColor: colors.ink,
              headerShadowVisible: false,
              headerTitleStyle: { color: colors.ink, fontWeight: "800" },
            }}
          >
            <Stack.Protected guard={hasFamily}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="family" options={{ headerShown: true, title: "Family" }} />
              <Stack.Screen name="settings" options={{ headerShown: true, title: "Settings" }} />
              <Stack.Screen name="account" options={{ headerShown: true, title: "Account & security" }} />
              <Stack.Screen name="categories" options={{ headerShown: true, title: "Categories" }} />
              <Stack.Screen name="budgets" options={{ headerShown: true, title: "Budgets" }} />
              <Stack.Screen name="goals" options={{ headerShown: true, title: "Goals" }} />
              <Stack.Screen name="sms-import" options={{ headerShown: true, title: "SMS transactions" }} />
              <Stack.Screen name="lending" options={{ headerShown: true, title: "Lend & borrow" }} />
              <Stack.Screen name="lending-person" options={{ headerShown: true, title: "Lend & borrow" }} />
              <Stack.Screen name="recurring" options={{ headerShown: true, title: "Repeating payments" }} />
              <Stack.Screen name="recurring-form" options={{ presentation: "modal", headerShown: true, title: "Repeating payment" }} />
              <Stack.Screen
                name="transaction-form"
                options={{ presentation: "modal", headerShown: true, title: "Transaction" }}
              />
            </Stack.Protected>

            <Stack.Protected guard={!hasFamily}>
              <Stack.Screen name="onboarding" />
            </Stack.Protected>
          </Stack>
        </SmsImportProvider>
      </PrefsProvider>
    </SecurityGate>
  );
}
