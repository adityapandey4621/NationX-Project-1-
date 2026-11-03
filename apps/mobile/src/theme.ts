import { useColorScheme } from "react-native";

/** NationX mobile design tokens. Minimum touch target 48dp; body text 16sp for low-end, sunlit screens. */
const light = {
  bg: "#F8FAFA", card: "#FFFFFF", text: "#0F1F1E", muted: "#5B6B69", border: "#D5DEDD",
  primary: "#0F766E", onPrimary: "#FFFFFF", primarySoft: "#D7F0EC", danger: "#B42318", dangerSoft: "#FDE8E6",
  success: "#166534", successSoft: "#DCF5E4", warn: "#92400E", warnSoft: "#FDEFD0", skeleton: "#E6ECEB",
};
const dark: typeof light = {
  bg: "#0B1514", card: "#12201F", text: "#EAF2F1", muted: "#9FB3B0", border: "#26403D",
  primary: "#34B8AB", onPrimary: "#06201D", primarySoft: "#123B37", danger: "#FF8A80", dangerSoft: "#3A1815",
  success: "#7BE0A0", successSoft: "#12351F", warn: "#F5C26B", warnSoft: "#3A2A0C", skeleton: "#1B2E2C",
};
export type Colors = typeof light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const type = { small: 13, body: 16, large: 18, title: 22, display: 28 } as const;
export const TOUCH = 48;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}