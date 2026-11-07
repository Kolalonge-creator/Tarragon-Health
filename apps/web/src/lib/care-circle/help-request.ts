import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * P22 / PD-08: the kinds of help a patient can ask their Care Circle for. The same five values as the database CHECK on
 * care_circle_help_alerts.request_type (20261107011314); order is the order shown on screen.
 */
export const HELP_REQUEST_TYPES = ["booking", "test_payment", "medicine_collection", "transport", "call_me"] as const;
export type HelpRequestType = (typeof HELP_REQUEST_TYPES)[number];

/** The longest note the database accepts (CHECK 1..200 after trimming). */
export const HELP_NOTE_MAX = 200;

export const helpRequestSchema = z.object({
  type: z.enum(HELP_REQUEST_TYPES),
  note: z
    .string()
    .trim()
    .max(HELP_NOTE_MAX)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type HelpRequestInput = z.input<typeof helpRequestSchema>;

export function helpRequestTypeLabelKey(type: HelpRequestType): MessageKey {
  return `circlehelp.type.${type}` as MessageKey;
}

/** A value read back from the database: one of the five, or null for an alert sent before typed requests (or any unknown value). */
export function parseHelpRequestType(value: unknown): HelpRequestType | null {
  return typeof value === "string" && (HELP_REQUEST_TYPES as readonly string[]).includes(value) ? (value as HelpRequestType) : null;
}

/**
 * The arguments for public.send_circle_help_alert. Location is added only when the caller has one (consent on and the browser gave it).
 * Returns null when the input does not validate, so nothing is sent.
 */
export function buildHelpAlertArgs(
  input: HelpRequestInput,
  pos: { lat: number; lng: number; accuracy: number } | null,
): Record<string, string | number> | null {
  const parsed = helpRequestSchema.safeParse(input);
  if (!parsed.success) return null;
  const args: Record<string, string | number> = { p_request_type: parsed.data.type };
  if (parsed.data.note) args.p_note = parsed.data.note;
  if (pos) {
    args.p_lat = pos.lat;
    args.p_lng = pos.lng;
    args.p_accuracy_m = pos.accuracy;
  }
  return args;
}

/**
 * True when the database does not yet have the typed version of the RPC (PostgREST "no function matches", PGRST202). This only happens in
 * the short window where the app is deployed before the migration applies; the card then retries the plain call so asking for help never
 * fails because of a deploy order.
 */
export function isMissingTypedSignature(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST202";
}

/** Drops the two typed arguments, for the deploy-window retry. */
export function withoutTypedArgs(args: Record<string, string | number>): Record<string, string | number> {
  const { p_request_type: _t, p_note: _n, ...rest } = args;
  void _t;
  void _n;
  return rest;
}
