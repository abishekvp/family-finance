import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { useTheme } from "../context/ThemeContext";

export interface DonutSlice {
  key: string;
  color: string;
  value: number;
}

/**
 * A pie chart with a hole for a label: each slice is an arc of one circle's stroke, drawn clockwise
 * from 12 o'clock in the order given.
 */
export function DonutChart({
  slices,
  size = 208,
  thickness = 30,
  children,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  /** Shown in the middle. */
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  // A hairline between slices, unless there's only one.
  const gap = slices.length > 1 ? Math.min(2, circumference / 200) : 0;

  let offset = 0;
  const arcs = slices.map((slice) => {
    const length = total > 0 ? (Math.max(0, slice.value) / total) * circumference : 0;
    const arc = { ...slice, start: offset, length: Math.max(0, length - gap) };
    offset += length;
    return arc;
  });

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.surfaceSunken} strokeWidth={thickness} fill="none" />
          {arcs.map((arc) =>
            arc.length > 0 ? (
              <Circle
                key={arc.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={arc.color}
                strokeWidth={thickness}
                fill="none"
                strokeDasharray={`${arc.length} ${circumference - arc.length}`}
                strokeDashoffset={-arc.start}
              />
            ) : null
          )}
        </G>
      </Svg>
      <View style={{ alignItems: "center", paddingHorizontal: thickness + 8 }}>{children}</View>
    </View>
  );
}
