/**
 * S59c: safety-net advice, "Go to a hospital or call for help straight away if ...", and the low-bandwidth "save this card" text.
 *
 * TWO LAYERS, ONE DIRECTION.
 *   1. The GENERIC safety net is always shown, from the string catalogue (`symptom.safety.*`): get care now if it gets worse quickly, go to
 *      the nearest hospital, ask someone to help. It does not depend on any config, so a missing or unsigned config can only ever leave the
 *      generic block on screen, never an empty one.
 *   2. SPECIFIC triggers per pathway and per category come from `symptom.safety_net`, an UNSIGNED DRAFT until the CMO signs it. They are
 *      added to the generic block, never instead of it. Unsigned, malformed or drifted means no specific lines.
 *
 * NUMBERS. No helpline number is invented or shipped. The one number the config may carry is the national emergency number, and it is
 * shown only when the config is in force AND `confirmed` is true AND it is a short digit string; the wording says "where it connects".
 *
 * Pure. No model, no network, no storage: the card is text built from what is already on the screen, for the person to copy or
 * screenshot, and it is never saved by this code.
 */
import { z } from "zod";
import { TRIAGE_CATEGORIES, type TriageCategory } from "../types/index";
import { envelopeShape, parseInForce } from "./ux-config";

export const safetyNetEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    /** A pathway key, or `*` for every pathway. */
    pathway_key: z.string().regex(/^([a-z][a-z0-9_]*|\*)$/),
    /** A triage category, or `*` for every category. */
    category: z.union([z.enum(TRIAGE_CATEGORIES), z.literal("*")]),
    /** Each line completes "Go to a hospital or call for help straight away if ...". */
    triggers: z.array(z.string().min(5).max(160)).min(1).max(8),
  })
  .strict();

export const safetyNetConfigSchema = z
  .object({
    ...envelopeShape,
    emergency_number: z.object({ value: z.string().regex(/^[0-9]{3,5}$/), confirmed: z.boolean() }).strict().nullable(),
    entries: z.array(safetyNetEntrySchema).min(1).max(100),
  })
  .strict()
  .refine((c) => new Set(c.entries.map((e) => e.id)).size === c.entries.length, { message: "duplicate safety net entry id" });
export type SafetyNetConfig = z.infer<typeof safetyNetConfigSchema>;

export interface SafetyNet {
  /** Extra trigger lines for this pathway and category, in config order, without repeats. Empty when the config is not in force. */
  specific: string[];
  /** The national emergency number, only when it is signed and confirmed. */
  emergencyNumber: string | null;
}

export function buildSafetyNet(input: { pathwayKey: string; category: TriageCategory }, rawConfig: unknown): SafetyNet {
  const config = parseInForce(safetyNetConfigSchema, rawConfig);
  if (!config) return { specific: [], emergencyNumber: null };
  const lines: string[] = [];
  for (const e of config.entries) {
    if (e.pathway_key !== "*" && e.pathway_key !== input.pathwayKey) continue;
    if (e.category !== "*" && e.category !== input.category) continue;
    for (const t of e.triggers) if (!lines.includes(t)) lines.push(t);
  }
  const number = config.emergency_number && config.emergency_number.confirmed ? config.emergency_number.value : null;
  return { specific: lines, emergencyNumber: number };
}

export interface SaveCardParts {
  title: string;
  /** e.g. the date of the check, or null. */
  dateLine: string | null;
  /** The pathway label, or null (the person can leave it off a card they will show someone). */
  complaint: string | null;
  resultLine: string;
  nextStep: string | null;
  safetyHeading: string;
  safetyLines: readonly string[];
  /** Plain lines after the bullet list (go to the nearest hospital, the emergency number when confirmed). */
  safetyClosing?: readonly string[];
  notADiagnosis: string;
  footer: string;
}

/**
 * Plain text, no markup, no links, no images: it pastes into any message, prints, or reads aloud. Empty parts are dropped. The text is
 * built from the parts it is given; it adds nothing (in particular no pregnancy answer, no raw typed text, no ids).
 */
export function buildSaveCard(p: SaveCardParts): string {
  const out: string[] = [p.title];
  if (p.dateLine) out.push(p.dateLine);
  if (p.complaint) out.push(p.complaint);
  out.push("", p.resultLine);
  if (p.nextStep) out.push(p.nextStep);
  if (p.safetyLines.length > 0) {
    out.push("", p.safetyHeading);
    for (const l of p.safetyLines) out.push(`- ${l}`);
    for (const l of p.safetyClosing ?? []) out.push(l);
  }
  out.push("", p.notADiagnosis, p.footer);
  return out.filter((l, i, all) => !(l === "" && (all[i - 1] === "" || i === 0))).join("\n");
}
