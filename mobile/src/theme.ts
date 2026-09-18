/**
 * Design tokens for the native app — the React Native equivalent of
 * client/src/styles/tokens.css. Same names, same values (converted from the web's "R G B"
 * triplets to hex), so the two apps read as one product. See ../../DESIGN.md.
 */

export interface Palette {
  canvas: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  line: string;
  lineStrong: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;

  brand50: string;
  brand100: string;
  brand500: string;
  brand600: string;
  brand700: string;
  brandSoft: string;

  income: string;
  incomeSoft: string;
  expense: string;
  expenseSoft: string;
  warn: string;
  warnSoft: string;
  info: string;
  infoSoft: string;

  white: string;
  overlay: string;
}

export const LIGHT: Palette = {
  canvas: "#F4F6FC",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  surfaceSunken: "#F0F2F9",
  line: "#E2E6F1",
  lineStrong: "#CBD2E4",
  ink: "#0D1122",
  inkMuted: "#5C667C",
  inkSubtle: "#868FA4",

  brand50: "#EEF0FF",
  brand100: "#E0E3FF",
  brand500: "#6D5FF0",
  brand600: "#5B46E5",
  brand700: "#4C36C9",
  brandSoft: "#EEF0FF",

  income: "#059669",
  incomeSoft: "#DCFAEF",
  expense: "#E11D48",
  expenseSoft: "#FFE4EA",
  warn: "#D97706",
  warnSoft: "#FEF3DB",
  info: "#0284C7",
  infoSoft: "#E0F2FE",

  white: "#FFFFFF",
  overlay: "rgba(13, 17, 34, 0.45)",
};

export const DARK: Palette = {
  canvas: "#070A16",
  surface: "#12162A",
  surfaceRaised: "#181D34",
  surfaceSunken: "#0C1020",
  line: "#282F4C",
  lineStrong: "#3C4568",
  ink: "#E9EDF9",
  inkMuted: "#96A0B8",
  inkSubtle: "#707A92",

  brand50: "#211E48",
  brand100: "#2C2860",
  brand500: "#9188FA",
  brand600: "#8277F8",
  brand700: "#A59EFC",
  brandSoft: "#211E48",

  income: "#34D399",
  incomeSoft: "#082E2D",
  expense: "#FB7185",
  expenseSoft: "#3C1221",
  warn: "#FBBF24",
  warnSoft: "#382608",
  info: "#38BDF8",
  infoSoft: "#09283F",

  white: "#FFFFFF",
  overlay: "rgba(0, 0, 0, 0.6)",
};

/** The gradient stops behind every primary button, progress fill and the aurora backdrop. */
export const BRAND_GRADIENT = ["#5B46E5", "#8B5CF6", "#22D3EE"] as const;

export const AURORA_STOPS_LIGHT = ["#EEF0FF", "#F4F6FC", "#F4F6FC"] as const;
export const AURORA_STOPS_DARK = ["#1B1440", "#0A0E1F", "#070A16"] as const;

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };

export const CHART_SWATCHES = [
  "#6D5FF0",
  "#A855F7",
  "#22D3EE",
  "#2DD4BF",
  "#84CC16",
  "#F59E0B",
  "#FB7185",
  "#EC4899",
  "#0EA5E9",
  "#10B981",
];
