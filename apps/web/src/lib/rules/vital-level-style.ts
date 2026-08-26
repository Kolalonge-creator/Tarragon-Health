/** Same green/amber/red/emergency/unknown scale every per-vital classifier
 * in this directory (bp/spo2/temperature/glucose-classification.ts) returns. */
export type VitalLevel = "green" | "amber" | "red" | "emergency" | "unknown";

/** Clinical dashboard status colours (a separate system from brand colour,
 * per the brand guide) — the exact tint the patient-facing vitals history
 * already uses for this classification, shared here so the clinician-facing
 * patient monitoring grid reads the same severity the same way rather than a
 * second palette. */
export const VITAL_LEVEL_BADGE_CLASSNAME: Record<Exclude<VitalLevel, "unknown">, string> = {
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  emergency: "bg-red-600 text-white",
};

/** Same palette as VITAL_LEVEL_BADGE_CLASSNAME, split into StatTile's
 * tintClassName/iconClassName pair (see severity-tile-tint.ts for the
 * equivalent done off Badge variants elsewhere). */
export const VITAL_LEVEL_TILE_TINT: Record<
  Exclude<VitalLevel, "unknown">,
  { tintClassName: string; iconClassName: string }
> = {
  green: { tintClassName: "bg-emerald-100", iconClassName: "text-emerald-800" },
  amber: { tintClassName: "bg-amber-100", iconClassName: "text-amber-800" },
  red: { tintClassName: "bg-red-100", iconClassName: "text-red-800" },
  emergency: { tintClassName: "bg-red-600", iconClassName: "text-white" },
};
