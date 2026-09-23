import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, type ColorSchemeName } from "react-native";
import * as SecureStore from "expo-secure-store";
import { DARK, LIGHT, type Palette } from "../theme";

export type ThemeChoice = "light" | "dark" | "system";

// SecureStore keys may only contain [A-Za-z0-9._-]; a ":" makes every read and write throw.
const THEME_KEY = "familyFinance.theme";

interface ThemeContextValue {
  choice: ThemeChoice;
  resolved: "light" | "dark";
  colors: Palette;
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function resolve(choice: ThemeChoice, system: ColorSchemeName): "light" | "dark" {
  if (choice === "system") return system === "dark" ? "dark" : "light";
  return choice;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(() => Appearance.getColorScheme() ?? "light");

  useEffect(() => {
    SecureStore.getItemAsync(THEME_KEY)
      .then((raw) => {
        if (raw === "light" || raw === "dark" || raw === "system") setChoiceState(raw);
      })
      .catch(() => undefined);

    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystemScheme(colorScheme));
    return () => sub.remove();
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    SecureStore.setItemAsync(THEME_KEY, next).catch(() => undefined);
  }, []);

  const resolved = resolve(choice, systemScheme);
  const colors = resolved === "dark" ? DARK : LIGHT;

  const value = useMemo(() => ({ choice, resolved, colors, setChoice }), [choice, resolved, colors, setChoice]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
