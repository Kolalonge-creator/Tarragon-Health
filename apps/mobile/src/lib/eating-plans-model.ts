import { parseEatingGuidance, type EatingGuidance } from "@tarragon/shared";

/**
 * Pure rules for the eating plans and swaps read view on the phone (S50a). No I/O, so every branch is unit tested.
 *
 * The answer is the server's (`/api/mobile/nutrition/eating-plans`, from the database gate). The phone keeps ONE copy so the plan can be read
 * with no signal, under three rules that keep that safe:
 *   - a fresh "unavailable" answer ERASES the copy (a person who became pregnant, was put under a hold or lost the plan sees nothing at once);
 *   - a copy older than CACHE_MAX_AGE_DAYS is not shown (whether a plan may be shown can change while the phone is offline);
 *   - a copy is only ever shown when the request FAILED (offline, or a server error: the route answers 503, never "unavailable", for a
 *     database failure). A server answer, of any kind, always wins;
 *   - an answer that includes the pregnancy plan is never saved.
 */
export const CACHE_MAX_AGE_DAYS = 7;

export interface CachedGuidance {
  json: string;
  savedAt: string;
}

export interface EatingResult {
  guidance: EatingGuidance;
  fromCache: boolean;
  cache: { action: "write"; json: string } | { action: "clear" } | { action: "none" };
}

export function chooseEatingResult(fresh: unknown | null, cached: CachedGuidance | null, now: Date): EatingResult {
  if (fresh !== null && fresh !== undefined) {
    const guidance = parseEatingGuidance(fresh);
    // The pregnancy plan is shown but NEVER saved: a saved copy would hold a person's pregnancy at rest on the phone, and a phone that is
    // offline cannot learn that the plan has since been withdrawn. An answer with it clears any older copy instead.
    if (guidance.state === "ok" && !guidance.plans.some((p) => p.code === "pregnancy")) {
      return { guidance, fromCache: false, cache: { action: "write", json: JSON.stringify(fresh) } };
    }
    return { guidance, fromCache: false, cache: { action: "clear" } };
  }
  // the request failed: fall back to the copy on the phone, if it is recent enough and still readable
  if (cached) {
    const ageMs = now.getTime() - Date.parse(cached.savedAt);
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
      try {
        const guidance = parseEatingGuidance(JSON.parse(cached.json));
        if (guidance.state === "ok") return { guidance, fromCache: true, cache: { action: "none" } };
      } catch {
        // an unreadable copy is no copy
      }
    }
  }
  return { guidance: { state: "unavailable" }, fromCache: false, cache: { action: "none" } };
}

const REFERRAL_STATUS_TEXT: Record<string, string> = {
  requested: "You asked for nutrition support. Your care team will follow up to arrange a dietitian visit.",
  scheduled: "Your dietitian visit is scheduled.",
  consultation_complete: "Your dietitian visit is done. A personal plan is being prepared.",
  plan_issued: "Your personal nutrition plan is ready. Ask your care team to walk you through it.",
  declined: "This request was not taken forward right now.",
  not_applicable: "Nutrition support was not needed for this request.",
};

/** Words for the referral status, or null for a status the phone does not know (then nothing is shown rather than a guess). */
export function referralStatusText(status: string): string | null {
  return REFERRAL_STATUS_TEXT[status] ?? null;
}

export function referralStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
