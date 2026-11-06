import type { BadgeProps } from "./components/badge";
import { LEGACY_STATUS_COLOUR, STATUS_CLASSES } from "./status";
import type { ClinicalStatusLevel } from "./tokens";

/** Maps a Badge variant to the matching StatTile tint/icon override classes,
 * so severity-count tiles read consistently with the Badge chips already on
 * each worklist row. Deliberately separate from lib/worklist/level-badge.ts
 * (which stays untouched) — this is presentation glue, not the clinical
 * status taxonomy itself. Built on the clinical status tokens (tokens.ts),
 * so it follows the night palette without dark: variants. */
const tile = (level: ClinicalStatusLevel) => ({
  tintClassName: STATUS_CLASSES[level].tint,
  iconClassName: STATUS_CLASSES[level].icon,
});

export const SEVERITY_TILE_TINT: Record<
  NonNullable<BadgeProps["variant"]>,
  { tintClassName: string; iconClassName: string }
> = {
  critical: tile("critical"),
  urgent: tile("urgent"),
  attention: tile("attention"),
  normal: tile("normal"),
  info: tile("info"),
  inactive: tile("inactive"),
  red: tile(LEGACY_STATUS_COLOUR.red),
  amber: tile(LEGACY_STATUS_COLOUR.amber),
  blue: tile(LEGACY_STATUS_COLOUR.blue),
  grey: tile(LEGACY_STATUS_COLOUR.grey),
  green: tile(LEGACY_STATUS_COLOUR.green),
};
