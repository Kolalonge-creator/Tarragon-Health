/**
 * The six urgency levels (spec 12.4), DERIVED from the four triage categories by a mapping table.
 *
 * SOURCE OF TRUTH. The four-category result (`emergency`, `urgent`, `routine`, `self_management`) stays the source of truth. It
 * is what the assessment row stores, what the escalation trigger reads and what every existing escalation keys off. The six
 * levels are a presentation that is computed from it by a table the CMO signs; nothing reads a level back to make a decision.
 *
 * UNSIGNED MEANS HIDDEN. The map is PROPOSED configuration (`symptom.urgency_map`). While it is a draft, or when it fails
 * validation, `deriveUrgencyLevel` returns null and the screen shows only the four-category result. Shipping the draft therefore
 * changes nothing a patient sees. This module signs nothing.
 *
 * SHAPE OF THE GUARANTEE. A map is only valid when it is total (every category has an `any` row), and monotone: a more urgent
 * category never maps to a less urgent level, and a result a clinician has been asked to review never maps to a less urgent
 * level than the same category without review. An invalid map is treated exactly like an unsigned one.
 */
import { z } from "zod";
import { TRIAGE_CATEGORIES, type TriageCategory } from "../types/index";

export const URGENCY_LEVELS = ["self_care", "see_pharmacist", "doctor_within_days", "doctor_within_24_hours", "doctor_today", "emergency_now"] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

const LEVEL_RANK: Record<UrgencyLevel, number> = {
  self_care: 0,
  see_pharmacist: 1,
  doctor_within_days: 2,
  doctor_within_24_hours: 3,
  doctor_today: 4,
  emergency_now: 5,
};
export function urgencyRank(level: UrgencyLevel): number {
  return LEVEL_RANK[level];
}

const CATEGORY_RANK: Record<TriageCategory, number> = { emergency: 3, urgent: 2, routine: 1, self_management: 0 };

export const QUALIFIERS = ["any", "review_required"] as const;
export type UrgencyQualifier = (typeof QUALIFIERS)[number];

export const urgencyMapSchema = z
  .object({
    status: z.enum(["draft", "signed_off"]),
    clinical_sign_off: z.object({ by: z.string().min(1), at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().nullable(),
    rows: z
      .array(
        z
          .object({
            category: z.enum(TRIAGE_CATEGORIES),
            qualifier: z.enum(QUALIFIERS),
            level: z.enum(URGENCY_LEVELS),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type UrgencyMap = z.infer<typeof urgencyMapSchema>;

function levelFor(map: UrgencyMap, category: TriageCategory, reviewRequired: boolean): UrgencyLevel | null {
  if (reviewRequired) {
    const specific = map.rows.find((r) => r.category === category && r.qualifier === "review_required");
    if (specific) return specific.level;
  }
  return map.rows.find((r) => r.category === category && r.qualifier === "any")?.level ?? null;
}

/** Why a map is not usable, or null when it is total and monotone. Exposed so a sign-off screen can say what is wrong. */
export function urgencyMapProblem(map: UrgencyMap): string | null {
  for (const c of TRIAGE_CATEGORIES) {
    if (!map.rows.some((r) => r.category === c && r.qualifier === "any")) return `no "any" row for ${c}`;
    const seen = new Set<string>();
    for (const r of map.rows.filter((x) => x.category === c)) {
      if (seen.has(r.qualifier)) return `two rows for ${c} / ${r.qualifier}`;
      seen.add(r.qualifier);
    }
  }
  for (const a of TRIAGE_CATEGORIES) {
    for (const b of TRIAGE_CATEGORIES) {
      if (CATEGORY_RANK[a] < CATEGORY_RANK[b]) {
        for (const reviewA of [false, true]) {
          for (const reviewB of [false, true]) {
            if (reviewA && !reviewB) continue; // only compare like with like or a higher review state
            const la = levelFor(map, a, reviewA);
            const lb = levelFor(map, b, reviewB);
            if (la && lb && urgencyRank(lb) < urgencyRank(la)) return `${b} maps to a lower level than ${a}`;
          }
        }
      }
    }
    for (const c of [a]) {
      const plain = levelFor(map, c, false);
      const reviewed = levelFor(map, c, true);
      if (plain && reviewed && urgencyRank(reviewed) < urgencyRank(plain)) return `${c} with review maps lower than without`;
    }
  }
  // an emergency category must reach the top level: a map that softens an emergency is never usable
  const top = levelFor(map, "emergency", false);
  if (top !== "emergency_now") return "emergency must map to emergency_now";
  return null;
}

/** True when the map may be used to show levels: signed with a named signer, and valid. */
export function urgencyMapInForce(raw: unknown): UrgencyMap | null {
  const parsed = urgencyMapSchema.safeParse(raw);
  if (!parsed.success) return null;
  const map = parsed.data;
  if (map.status !== "signed_off" || map.clinical_sign_off === null) return null;
  return urgencyMapProblem(map) === null ? map : null;
}

/** The derived level, or null when no signed, valid map exists (the screen then shows the four-category result only). */
export function deriveUrgencyLevel(category: TriageCategory, reviewRequired: boolean, rawMap: unknown): UrgencyLevel | null {
  const map = urgencyMapInForce(rawMap);
  if (!map) return null;
  return levelFor(map, category, reviewRequired);
}
