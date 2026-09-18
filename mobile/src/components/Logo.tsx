import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { StyleProp, ViewStyle } from "react-native";

/**
 * The Family Finance mark: an aurora-gradient tile with three ascending bars. Mirrors
 * client/src/components/Logo.tsx exactly so the brand reads identically on both apps.
 */
export function Logo({ size = 40, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" style={style}>
      <Defs>
        <LinearGradient id="tile" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#5B46E5" />
          <Stop offset="0.55" stopColor="#8B5CF6" />
          <Stop offset="1" stopColor="#22D3EE" />
        </LinearGradient>
      </Defs>
      <Rect width="48" height="48" rx="14" fill="url(#tile)" />
      <Rect x="10.5" y="25" width="7.5" height="12.5" rx="3.75" fill="#fff" opacity={0.55} />
      <Rect x="20.25" y="18.5" width="7.5" height="19" rx="3.75" fill="#fff" opacity={0.78} />
      <Rect x="30" y="10.5" width="7.5" height="27" rx="3.75" fill="#fff" />
    </Svg>
  );
}
