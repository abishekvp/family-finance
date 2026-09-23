import { Text, View } from "react-native";
import { Download, Sparkles } from "lucide-react-native";
import { useAppUpdate } from "../context/UpdateContext";
import { useTheme } from "../context/ThemeContext";
import { Button, ErrorText, ProgressBar, Sheet } from "./ui";

/** The "Update available" prompt. State and checking live in UpdateContext. */
export function UpdateChecker() {
  const { colors } = useTheme();
  const { release, status, progress, error, sheetOpen, install, dismiss } = useAppUpdate();

  if (!release || !sheetOpen) return null;

  const downloading = status === "downloading";

  return (
    <Sheet visible title="Update available" onClose={dismiss}>
      <View style={{ padding: 20, paddingTop: 4, gap: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Sparkles size={17} color={colors.brand600} />
          </View>
          <Text style={{ flex: 1, fontSize: 13.5, color: colors.inkMuted, lineHeight: 19 }}>
            Version {release.version} of Family Finance is ready. Update to get the latest fixes and
            features.
          </Text>
        </View>

        {release.notes ? (
          <View style={{ backgroundColor: colors.surfaceSunken, borderRadius: 14, padding: 14, gap: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.inkSubtle, textTransform: "uppercase", letterSpacing: 0.6 }}>
              What's new
            </Text>
            <Text style={{ fontSize: 13.5, color: colors.ink, lineHeight: 19 }}>{release.notes}</Text>
          </View>
        ) : null}

        {downloading && (
          <View style={{ gap: 6 }}>
            <ProgressBar value={progress ?? 0} />
            <Text style={{ fontSize: 12, color: colors.inkSubtle }}>
              {progress == null ? "Downloading…" : `Downloading… ${Math.round(progress * 100)}%`}
            </Text>
          </View>
        )}
        <ErrorText>{error}</ErrorText>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Later" variant="secondary" onPress={dismiss} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={downloading ? "Downloading" : "Update now"}
              loading={downloading}
              icon={<Download size={16} color="#fff" />}
              onPress={install}
            />
          </View>
        </View>
      </View>
    </Sheet>
  );
}
