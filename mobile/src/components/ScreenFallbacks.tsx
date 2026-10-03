import { useState } from "react";
import { ActivityIndicator, Pressable, Text, useColorScheme, View } from "react-native";
import { CloudOff, TriangleAlert } from "lucide-react-native";
import type { ErrorBoundaryProps } from "expo-router";
import { DARK, LIGHT, type Palette } from "../theme";

// These render where the app's providers may be missing (the root layout's error boundary sits
// outside ThemeProvider), so they take colours from the system scheme rather than useTheme().
function usePalette(): Palette {
  return useColorScheme() === "dark" ? DARK : LIGHT;
}

function Shell({
  icon,
  title,
  message,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  actions: { label: string; onPress: () => void | Promise<void>; primary?: boolean }[];
}) {
  const colors = usePalette();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center", padding: 28 }}>
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
        {icon}
      </View>
      <Text style={{ fontSize: 20, fontWeight: "900", color: colors.ink, textAlign: "center", marginTop: 18 }}>{title}</Text>
      <Text style={{ color: colors.inkMuted, textAlign: "center", marginTop: 8, lineHeight: 20 }}>{message}</Text>
      <View style={{ alignSelf: "stretch", gap: 10, marginTop: 24 }}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            disabled={busy !== null}
            onPress={async () => {
              setBusy(action.label);
              try {
                await action.onPress();
              } finally {
                setBusy(null);
              }
            }}
            style={({ pressed }) => ({
              height: 48,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: action.primary ? colors.brand600 : colors.surfaceSunken,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {busy === action.label ? (
              <ActivityIndicator color={action.primary ? "#fff" : colors.ink} />
            ) : (
              <Text style={{ color: action.primary ? "#fff" : colors.ink, fontWeight: "800" }}>{action.label}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Signed in on this phone, but the first connection to the server failed. */
export function OfflineScreen({ onRetry, onSignOut }: { onRetry: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const colors = usePalette();
  return (
    <Shell
      icon={<CloudOff size={24} color={colors.brand600} />}
      title="Can't connect right now"
      message="You're still signed in. Check your internet connection and try again."
      actions={[
        { label: "Try again", onPress: onRetry, primary: true },
        { label: "Sign out", onPress: onSignOut },
      ]}
    />
  );
}

/**
 * Shown instead of a blank screen when a screen throws while rendering. A release build has no red
 * box: without a boundary React unmounts the whole tree and the user is left looking at nothing.
 */
export function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const colors = usePalette();
  if (__DEV__) console.error(error);
  return (
    <Shell
      icon={<TriangleAlert size={24} color={colors.brand600} />}
      title="Something went wrong"
      message="This screen hit a problem. Your data is safe — try again."
      actions={[{ label: "Try again", onPress: retry, primary: true }]}
    />
  );
}
