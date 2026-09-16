import { Stack } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";

export default function AppLayout() {
  const { user } = useAuth();
  const hasFamily = (user?.families.length ?? 0) > 0;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={hasFamily}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>

      <Stack.Protected guard={!hasFamily}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
    </Stack>
  );
}
