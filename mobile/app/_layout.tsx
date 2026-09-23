import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import * as WebBrowser from "expo-web-browser";
import { AuthProvider, useAuth } from "../src/context/AuthContext";
import { SecurityProvider } from "../src/context/SecurityContext";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";
import { UpdateProvider } from "../src/context/UpdateContext";
import { Logo } from "../src/components/Logo";
import { UpdateChecker } from "../src/components/UpdateChecker";

SplashScreen.preventAutoHideAsync().catch(() => undefined);
// Closes the Google/Microsoft Custom Tab when it redirects back to familyfinance://oauth-callback.
WebBrowser.maybeCompleteAuthSession();

function RootNavigator() {
  const { user, isLoading } = useAuth();
  const { colors, resolved } = useTheme();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas }}>
        <Logo size={52} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={resolved === "dark" ? "light" : "dark"} />
      <UpdateChecker />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>

        <Stack.Protected guard={!user}>
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="forgot-password" />
        </Stack.Protected>

        <Stack.Screen name="oauth-callback" />

        <Stack.Screen
          name="invite/[token]"
          options={{ headerShown: true, title: "Family invite", presentation: "modal" }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <SecurityProvider>
            <UpdateProvider>
              <RootNavigator />
            </UpdateProvider>
          </SecurityProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
