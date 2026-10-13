import type { BadgeProps } from "@/components/ui/badge";

/** mutationFn throws the raw Postgrest error object on failure (see lib/queries/data-rights.ts) — it always carries a
 * `.message`, but the mutation's own `.error` is typed `unknown` by react-query. */
export function mutationErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Something went wrong sending this request. Please try again.";
}

export const STATUS_BADGE: Record<string, NonNullable<BadgeProps["variant"]>> = {
  pending: "amber",
  under_review: "blue",
  approved: "blue",
  approved_partial: "blue",
  approved_full: "blue",
  applied: "green",
  completed: "green",
  fulfilled: "green",
  denied: "red",
  cancelled: "grey",
};
