import { useTheme } from "./provider";

/**
 * The legacy `colors` names (ui/theme.ts) mapped to palette roles, for chrome and
 * screens that have not been rewritten on the kit yet. Same keys, so moving a file
 * is: swap the import for `const colors = useLegacyColors()` inside the component.
 * It follows the active scheme, so a moved file goes dark with the kit.
 *
 * `brandPressed` and `navy` are used as TEXT in the legacy code, so they map to the
 * text-safe roles (`brandText`, `navy`); `faint` was decorative-only and maps to the
 * subtle text role so it stays readable in both schemes.
 */
export function useLegacyColors() {
  const { colors: p } = useTheme();
  return {
    brand: p.brand,
    brandPressed: p.brandText,
    brandTint: p.brandTint,
    navy: p.navy,
    ink: p.text,
    muted: p.textMuted,
    subtle: p.textSubtle,
    faint: p.textSubtle,
    border: p.border,
    background: p.canvas,
    card: p.surface,
    pressed: p.surfaceMuted,
    groupBg: p.surfaceMuted,
    danger: p.dangerText,
    status: { warn: p.warnText, warnBg: p.warnBg, critical: p.dangerText, emergency: p.emergency },
  };
}
