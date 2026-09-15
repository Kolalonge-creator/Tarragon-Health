import { SEMANTIC_ICON } from "@/lib/icons";
import { StatTile } from "@/components/ui/stat-tile";
import { VITAL_LEVEL_TILE_TINT, type VitalLevel } from "@/lib/rules/vital-level-style";

/** One vital's tile on a patient monitoring card. Colour-coded (via `level`)
 * for the five vitals with a real clinical classifier — BP, SpO2,
 * temperature, glucose, pulse (extreme-value triage only, see
 * pulse-classification.ts — never arrhythmia/AF detection). Omit `level` for
 * a vital with no single-reading clinical threshold on this platform
 * (weight) or no clinical bands at all yet (HRV, sleep, steps) — it renders
 * as a plain informational tile rather than inventing a threshold. */
export function VitalTile({
  icon,
  label,
  value,
  unit,
  level,
}: {
  icon: keyof typeof SEMANTIC_ICON;
  label: string;
  value: string | null;
  unit?: string;
  level?: VitalLevel;
}) {
  const tint = level && level !== "unknown" ? VITAL_LEVEL_TILE_TINT[level] : undefined;
  return (
    <StatTile
      icon={SEMANTIC_ICON[icon]}
      label={label}
      value={value ?? "—"}
      unit={value ? unit : undefined}
      tintClassName={tint?.tintClassName}
      iconClassName={tint?.iconClassName}
      className="p-3 sm:p-3"
    />
  );
}
