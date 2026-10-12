import { useColorScheme } from "react-native";
import type { FlagColor } from "@ams/shared";

export interface Palette {
  scheme: "light" | "dark";
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primaryText: string;
  primarySoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  success: string;
  successSoft: string;
  focus: string;
  flag: Record<FlagColor, string>;
  chartLine: string;
  chartGrid: string;
}

const light: Palette = {
  scheme: "light",
  background: "#F6F7F9",
  surface: "#FFFFFF",
  surfaceAlt: "#EEF1F5",
  border: "#D5DAE1",
  text: "#111827",
  textMuted: "#4B5563",
  textInverse: "#FFFFFF",
  primary: "#1F5FD1",
  primaryText: "#FFFFFF",
  primarySoft: "#E3ECFC",
  danger: "#B42318",
  dangerSoft: "#FDECEA",
  warning: "#8A5A00",
  warningSoft: "#FFF4D6",
  success: "#18794E",
  successSoft: "#E6F4EC",
  focus: "#1F5FD1",
  flag: { green: "#18794E", amber: "#B76E00", red: "#C0262D", none: "#6B7280" },
  chartLine: "#1F5FD1",
  chartGrid: "#E2E6EC",
};

const dark: Palette = {
  scheme: "dark",
  background: "#0D1117",
  surface: "#161B22",
  surfaceAlt: "#1F2630",
  border: "#30363D",
  text: "#F0F3F6",
  textMuted: "#A9B1BB",
  textInverse: "#0D1117",
  primary: "#6EA8FE",
  primaryText: "#0D1117",
  primarySoft: "#1B2B45",
  danger: "#FF7B72",
  dangerSoft: "#3A1D1D",
  warning: "#F2CC60",
  warningSoft: "#3A2F12",
  success: "#56D364",
  successSoft: "#14301D",
  focus: "#6EA8FE",
  flag: { green: "#56D364", amber: "#F2CC60", red: "#FF7B72", none: "#8B949E" },
  chartLine: "#6EA8FE",
  chartGrid: "#283039",
};

export const palettes = { light, dark };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

/** Minimum size of anything tappable (Apple HIG 44pt, Material 48dp). */
export const MIN_TOUCH = 48;

export function useTheme(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

/** Text label and shape for a flag, so colour is never the only signal. */
export const FLAG_META: Record<FlagColor, { label: string; symbol: string }> = {
  green: { label: "OK", symbol: "●" },
  amber: { label: "Watch", symbol: "▲" },
  red: { label: "Alert", symbol: "■" },
  none: { label: "No flag", symbol: "○" },
};
