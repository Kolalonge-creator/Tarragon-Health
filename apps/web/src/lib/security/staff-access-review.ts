import { z } from "zod";
import { getProposedConfig } from "@tarragon/shared";
import type { Loaded, StaffAccessReviewStatus } from "./security-overview";
import { securityOverviewSchema } from "./security-overview";

/**
 * Read side of /admin/staff-access-review (security audit 2026-11-05, Phase 3). The tables are admin-read-only in the
 * database and written only by start_/decide_/complete_staff_access_review.
 */
interface Client {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(cols: string): {
      eq(col: string, value: string): {
        order(col: string, o: { ascending: boolean }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
}

export const reviewItemSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  role_at_review: z.string(),
  doctor_tier_at_review: z.string().nullable(),
  active_at_review: z.boolean(),
  is_test: z.boolean(),
  last_sign_in_at: z.string().nullable(),
  mfa_enrolled: z.boolean(),
  decision: z.enum(["keep", "remove", "change"]).nullable(),
  decision_note: z.string().nullable(),
  decided_at: z.string().nullable(),
  profiles: z.object({ full_name: z.string().nullable() }).nullable(),
});
export type ReviewItem = z.infer<typeof reviewItemSchema>;

const statusSchema = securityOverviewSchema.shape.staff_access_review;

export async function loadReviewStatus(client: unknown): Promise<Loaded<StaffAccessReviewStatus>> {
  const { data, error } = await (client as Client).rpc("staff_access_review_status");
  if (error) return { ok: false, message: "The review status could not be loaded." };
  const parsed = statusSchema.safeParse(data);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, message: "The review status came back in an unexpected shape." };
}

export async function loadReviewItems(client: unknown, reviewId: string): Promise<Loaded<ReviewItem[]>> {
  const { data, error } = await (client as Client)
    .from("staff_access_review_items")
    .select(
      "id, profile_id, role_at_review, doctor_tier_at_review, active_at_review, is_test, last_sign_in_at, mfa_enrolled, decision, decision_note, decided_at, profiles!staff_access_review_items_profile_id_fkey(full_name)"
    )
    .eq("review_id", reviewId)
    .order("role_at_review", { ascending: true });
  if (error) return { ok: false, message: "The accounts in this review could not be loaded." };
  const parsed = z.array(reviewItemSchema).safeParse(data);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, message: "The accounts came back in an unexpected shape." };
}

/** True when a sign-in is missing or older than the dormancy line (registry key security.staff_access_review). */
export function isDormant(lastSignInAt: string | null, dormantAfterDays: number, now: Date = new Date()): boolean {
  if (!lastSignInAt) return true;
  return now.getTime() - new Date(lastSignInAt).getTime() > dormantAfterDays * 24 * 60 * 60 * 1000;
}

export function dormantAfterDays(): number {
  return (getProposedConfig("security.staff_access_review").value as { dormant_after_days: number }).dormant_after_days;
}
