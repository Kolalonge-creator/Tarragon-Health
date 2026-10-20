import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { CARE_ACCESS_CATEGORIES } from "@/lib/queries/care-access";

/** One row of public.my_proxy_reviews(): a person who can see this account, and whether the yearly check is due. */
export const proxyReviewRowSchema = z.object({
  grant_id: z.string().uuid(),
  grantee_id: z.string().uuid(),
  first_name: z.string(),
  since: z.string(),
  categories: z.array(z.string()),
  due_at: z.string(),
  is_due: z.boolean(),
  days_overdue: z.number().int().nonnegative(),
  last_reviewed_at: z.string().nullable(),
});
export type ProxyReviewRow = z.infer<typeof proxyReviewRowSchema>;

const rowsSchema = z.array(proxyReviewRowSchema);
const dueAsProxySchema = z.array(z.object({ patient_id: z.string().uuid() }));

/** Parses the RPC result. A malformed payload is an error, never an empty list: an empty list reads as "nothing to review". */
export function parseProxyReviews(data: unknown): ProxyReviewRow[] {
  return rowsSchema.parse(data ?? []);
}

/** Only the rows that are due, oldest first. */
export function dueReviews(rows: readonly ProxyReviewRow[]): ProxyReviewRow[] {
  return rows.filter((r) => r.is_due).sort((a, b) => a.due_at.localeCompare(b.due_at));
}

export function categoryLabel(value: string): string {
  return CARE_ACCESS_CATEGORIES.find((c) => c.value === value)?.label ?? "Something else";
}

export const MY_PROXY_REVIEWS_KEY = ["my-proxy-reviews"] as const;
export const PROXY_REVIEW_DUE_AS_PROXY_KEY = ["proxy-review-due-as-proxy"] as const;

export function useMyProxyReviews() {
  return useQuery({
    queryKey: MY_PROXY_REVIEWS_KEY,
    queryFn: async (): Promise<ProxyReviewRow[]> => {
      const { data, error } = await createClient().rpc("my_proxy_reviews");
      if (error) throw error;
      return parseProxyReviews(data);
    },
  });
}

/** For the person who helps someone: only that a yearly check is due for them. Never what was chosen. */
export function useProxyReviewDueAsProxy() {
  return useQuery({
    queryKey: PROXY_REVIEW_DUE_AS_PROXY_KEY,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await createClient().rpc("proxy_review_due_as_proxy");
      if (error) throw error;
      return new Set(dueAsProxySchema.parse(data ?? []).map((r) => r.patient_id));
    },
  });
}
