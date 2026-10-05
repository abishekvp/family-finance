import { useEffect } from "react";
import { Stack } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import { PrefsProvider } from "../../src/context/PrefsContext";
import { SmsImportProvider } from "../../src/context/SmsImportContext";
import { useTheme } from "../../src/context/ThemeContext";
import { SecurityGate } from "../../src/components/SecurityGate";
import { TodayWidgetSync } from "../../src/components/TodayWidgetSync";
import { RecurringSync } from "../../src/components/RecurringSync";
import { UncategorizedReminderSync } from "../../src/components/UncategorizedReminderSync";
import { registerBackgroundSync } from "../../src/lib/backgroundSync";
import { ScreenErrorBoundary } from "../../src/components/ScreenFallbacks";

export { ScreenErrorBoundary as ErrorBoundary };

// A screen opened straight from a deep link (a home-screen widget's quick add) still gets the
// tabs underneath it, so going back lands on the transactions list instead of leaving the app.
export const unstable_settings = { initialRouteName: "(tabs)" };

export default function AppLayout() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const hasFamily = (user?.families.length ?? 0) > 0;

  useEffect(() => {
    if (hasFamily) registerBackgroundSync().catch(() => undefined);
  }, [hasFamily]);

  // Signing out (or the session ending) clears `user` a moment before the root navigator drops this
  // group. Every screen in here reads `user!`, so unmount them now rather than let one render
  // without a user — a render error in a release build leaves the app on a blank screen.
  if (!user) return null;

  return (
    <SecurityGate>
      <PrefsProvider>
        <SmsImportProvider>
          {hasFamily && <TodayWidgetSync />}
          {hasFamily && <RecurringSync />}
          {hasFamily && <UncategorizedReminderSync />}
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
              <Stack.Screen name="payee-rules" options={{ headerShown: true, title: "Payee rules" }} />
              <Stack.Screen name="uncategorized" options={{ headerShown: true, title: "Uncategorised" }} />
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
