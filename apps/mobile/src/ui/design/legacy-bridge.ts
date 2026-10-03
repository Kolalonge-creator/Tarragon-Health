import { useTheme } from "./provider";
import { textStyles } from "./typography";

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
    dangerBg: p.dangerBg,
    status: { warn: p.warnText, warnBg: p.warnBg, critical: p.dangerText, emergency: p.emergency },
  };
}

/**
 * The text field style every old screen declared for itself as a module-level
 * `textInputStyle` (border, radius, padding, 14px text), drawn in the active scheme: border,
 * text and background follow the palette. Used by scripts/port-to-scheme-aware.py.
 */
export function useTextInputStyle() {
  const colors = useLegacyColors();
  return {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    ...textStyles.body,
    color: colors.ink,
    backgroundColor: colors.card,
  } as const;
}
