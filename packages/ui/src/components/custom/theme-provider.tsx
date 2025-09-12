import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useState,
} from "react";
import type { ToasterProps } from "sonner";
import { THEME_COOKIE_MAX_AGE, THEME_COOKIE_NAME } from "@/constants";

export type Theme = ToasterProps["theme"];

type ThemeContextProps = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

export interface ThemeProviderProps extends PropsWithChildren {
  defaultTheme?: Theme;
  theme?: Theme;
  onThemeChange?: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextProps | null>(null);

export function ThemeProvider({
  children,
  defaultTheme = "light",
  theme: themeProp,
  onThemeChange: setThemeProp,
}: ThemeProviderProps) {
  // This is the internal state of the theme.
  // We use themeProp and setThemeProp for control from outside the component.
  const [_theme, _setTheme] = useState(defaultTheme);
  const theme = themeProp ?? _theme;
  const setTheme = useCallback(
    (value: Theme | ((value: Theme) => Theme)) => {
      const themeState = typeof value === "function" ? value(theme) : value;
      if (setThemeProp) {
        setThemeProp(themeState);
      } else {
        _setTheme(themeState || defaultTheme);
      }

      // This sets the cookie to keep the theme state.
      document.cookie = `${THEME_COOKIE_NAME}=${themeState}; path=/; max-age=${THEME_COOKIE_MAX_AGE}`;
    },
    [setThemeProp, theme, defaultTheme]
  );

  const contextValue = {
    theme,
    setTheme,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = use(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }
  return context;
}
