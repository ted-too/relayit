import { RiMoonLine, RiSunLine } from "@remixicon/react";
import { Button } from "@repo/ui/components/ui/coss/button";

const toggleTheme = () => {
  const dark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("theme", dark ? "dark" : "light");
};

/** Both icons render; CSS picks one, so SSR and hydration always agree. */
export function ThemeToggle() {
  return (
    <Button
      aria-label="Toggle colour theme"
      onClick={toggleTheme}
      size="icon"
      variant="ghost"
    >
      <RiSunLine className="hidden dark:block" />
      <RiMoonLine className="dark:hidden" />
    </Button>
  );
}
