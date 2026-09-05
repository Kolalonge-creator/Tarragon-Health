"use client";

import { Moon, Sun, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME_COOKIE, type ThemePreference } from "@/lib/theme";

export { THEME_COOKIE, type ThemePreference };

/** Order the button cycles through on each press. */
const CYCLE: ThemePreference[] = ["light", "dark", "system"];

const LABEL: Record<ThemePreference, string> = {
  light: "Light theme",
  dark: "Dark theme",
  system: "Match device theme",
};

const ICON: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: MonitorSmartphone,
};

/**
 * Cycles light -> dark -> system. Patient surface only: the preference is
 * applied as a data-theme attribute on AppShell's root (see globals.css'
 * Night theme block), so staff consoles and marketing never see it. The
 * choice persists in a cookie rather than localStorage so the server can
 * render the attribute on first paint with no flash of the wrong theme.
 */
export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: ThemePreference;
  onChange: (next: ThemePreference) => void;
}) {
  const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length];
  const Icon = ICON[theme];
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-9 w-9 p-0 text-charcoal-ink/70 hover:text-charcoal-ink dark:text-night-ink/70 dark:hover:text-night-ink"
      aria-label={`${LABEL[theme]} on. Switch to ${LABEL[next].toLowerCase()}`}
      title={LABEL[theme]}
      onClick={() => {
        try {
          document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        } catch {
          // A blocked cookie jar only costs persistence, never the switch.
        }
        onChange(next);
      }}
    >
      <Icon className="h-5 w-5" strokeWidth={2} />
    </Button>
  );
}
