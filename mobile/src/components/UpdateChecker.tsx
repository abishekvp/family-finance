import { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Download, Sparkles } from "lucide-react-native";
import { api, API_BASE_URL } from "../api/client";
import { useTheme } from "../context/ThemeContext";
import { Button, Sheet } from "./ui";

const DISMISSED_VERSION_KEY = "familyFinance.dismissedUpdateVersion";
// Strips the "/api" suffix API_BASE_URL carries so we can resolve the server-relative apkUrl.
const SERVER_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

function isNewer(remote: string, local: string): boolean {
  const r = remote.split(".").map(Number);
  const l = local.split(".").map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rp = r[i] ?? 0;
    const lp = l[i] ?? 0;
    if (rp > lp) return true;
    if (rp < lp) return false;
  }
  return false;
}

export function UpdateChecker() {
  const { colors } = useTheme();
  const [available, setAvailable] = useState<{ version: string; apkUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const currentVersion = Constants.expoConfig?.version ?? "0.0.0";

    (async () => {
      try {
        const res = await api.get<{ latestVersion: string; apkUrl: string }>("/app/version");
        if (cancelled || !isNewer(res.data.latestVersion, currentVersion)) return;

        const dismissed = await SecureStore.getItemAsync(DISMISSED_VERSION_KEY);
        if (dismissed === res.data.latestVersion) return;

        setAvailable({ version: res.data.latestVersion, apkUrl: res.data.apkUrl });
      } catch {
        // Offline or the endpoint is unreachable — fail silently, this is a nice-to-have.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;

  function dismiss() {
    if (available) SecureStore.setItemAsync(DISMISSED_VERSION_KEY, available.version).catch(() => undefined);
    setAvailable(null);
  }

  function update() {
    if (available) Linking.openURL(SERVER_ORIGIN + available.apkUrl).catch(() => undefined);
    setAvailable(null);
  }

  return (
    <Sheet visible title="Update available" onClose={dismiss}>
      <View style={{ padding: 20, paddingTop: 4, gap: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Sparkles size={17} color={colors.brand600} />
          </View>
          <Text style={{ flex: 1, fontSize: 13.5, color: colors.inkMuted, lineHeight: 19 }}>
            Version {available.version} of Family Finance is ready. Update to get the latest fixes and
            features.
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Later" variant="secondary" onPress={dismiss} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Update" icon={<Download size={16} color="#fff" />} onPress={update} />
          </View>
        </View>
      </View>
    </Sheet>
  );
}
