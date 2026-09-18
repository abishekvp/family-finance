import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../context/ThemeContext";
import { AURORA_STOPS_DARK, AURORA_STOPS_LIGHT } from "../theme";

/**
 * A calm gradient wash behind every screen — the native equivalent of the web app's animated
 * aurora. Native gradients don't animate for free the way a CSS radial blob does, so this is a
 * static three-stop wash rather than a literal port; it still reads as the same brand backdrop.
 */
export function AuroraBackground() {
  const { resolved } = useTheme();
  const stops = resolved === "dark" ? AURORA_STOPS_DARK : AURORA_STOPS_LIGHT;

  return (
    <LinearGradient
      colors={stops}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
}

/** Thin coloured glow used behind hero figures (net worth, stat tiles) — a hint of the aurora. */
export function AccentGlow({ color, style }: { color: string; style?: object }) {
  return (
    <View pointerEvents="none" style={[styles.glowWrap, style]}>
      <LinearGradient
        colors={[`${color}33`, `${color}00`]}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  glowWrap: {
    position: "absolute",
    borderRadius: 999,
    overflow: "hidden",
  },
});
