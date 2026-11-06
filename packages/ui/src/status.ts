import type { ClinicalStatusLevel } from "./tokens";

/**
 * Tailwind classes for the clinical status tokens (see tokens.ts,
 * clinicalStatusColors). Written out in full so Tailwind's source scan finds
 * every class; never build one of these names from a template string.
 *
 * The CSS variables behind them switch to the night palette inside a
 * [data-theme="dark"] subtree, so none of these needs a dark: variant.
 */
export const STATUS_CLASSES: Record<
  ClinicalStatusLevel,
  {
    /** Soft background for a chip or a tile icon circle. */
    tint: string;
    /** Words in the status colour (AA on the tint and on every surface). */
    text: string;
    /** Icon in the status colour, on the tint or on a card. */
    icon: string;
    /** Small dot or bar. Pair it with a word, never alone. */
    dot: string;
    /** Card or chip outline. */
    border: string;
  }
> = {
  critical: {
    tint: "bg-status-critical-tint",
    text: "text-status-critical-text",
    icon: "text-status-critical-text",
    dot: "bg-status-critical",
    border: "border-status-critical/40",
  },
  urgent: {
    tint: "bg-status-urgent-tint",
    text: "text-status-urgent-text",
    icon: "text-status-urgent-text",
    dot: "bg-status-urgent",
    border: "border-status-urgent/40",
  },
  attention: {
    tint: "bg-status-attention-tint",
    text: "text-status-attention-text",
    icon: "text-status-attention-text",
    dot: "bg-status-attention",
    border: "border-status-attention/40",
  },
  normal: {
    tint: "bg-status-normal-tint",
    text: "text-status-normal-text",
    icon: "text-status-normal-text",
    dot: "bg-status-normal",
    border: "border-status-normal/40",
  },
  info: {
    tint: "bg-status-info-tint",
    text: "text-status-info-text",
    icon: "text-status-info-text",
    dot: "bg-status-info",
    border: "border-status-info/40",
  },
  inactive: {
    tint: "bg-status-inactive-tint",
    text: "text-status-inactive-text",
    icon: "text-status-inactive-text",
    dot: "bg-status-inactive",
    border: "border-status-inactive/40",
  },
};

/**
 * The older colour-named Badge variants, kept so the many existing callers
 * keep working, mapped onto the semantic levels. New code should pass the
 * level name ("attention") rather than the colour ("amber").
 */
export const LEGACY_STATUS_COLOUR: Record<"red" | "amber" | "blue" | "grey" | "green", ClinicalStatusLevel> = {
  red: "critical",
  amber: "attention",
  blue: "info",
  grey: "inactive",
  green: "normal",
};
