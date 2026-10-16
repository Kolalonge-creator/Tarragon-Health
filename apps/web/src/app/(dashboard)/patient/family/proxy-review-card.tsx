"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { CareAccessCategory } from "@/lib/queries/care-access";
import {
  categoryLabel,
  dueReviews,
  MY_PROXY_REVIEWS_KEY,
  useMyProxyReviews,
  type ProxyReviewRow,
} from "@/lib/queries/proxy-review";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Mode = "idle" | "narrowing" | "confirming_remove";

function ReviewItem({ row, onDone }: { row: ProxyReviewRow; onDone: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("idle");
  const [keep, setKeep] = useState<string[]>(row.categories);
  const [message, setMessage] = useState<string | null>(null);

  const answer = useMutation({
    mutationFn: async (input: { action: "keep" | "narrow" | "remove" }) => {
      setMessage(null);
      const { error } = await createClient().rpc("answer_proxy_review", {
        p_grantee: row.grantee_id,
        p_action: input.action,
        ...(input.action === "narrow" ? { p_categories: keep as CareAccessCategory[], p_notify: false } : {}),
      });
      // P0002: the access is already gone (another tab, a double click). For a removal that is the outcome the person wanted.
      if (error && !(input.action === "remove" && error.code === "P0002")) throw error;
      return input.action;
    },
    onSuccess: async (action) => {
      setMode("idle");
      // The answered row leaves the list the moment the list refreshes, so the confirmation is lifted to the card, which outlives it.
      onDone(
        action === "keep"
          ? `Thank you. ${row.first_name} keeps their access, and we will ask again in a year.`
          : action === "narrow"
            ? `Saved. ${row.first_name} can now see less.`
            : `${row.first_name}'s access has stopped.`,
      );
      await queryClient.invalidateQueries({ queryKey: MY_PROXY_REVIEWS_KEY });
      await queryClient.invalidateQueries({ queryKey: ["my-care-followers"] });
    },
    onError: (error: unknown) => {
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
      setMessage(
        code === "22023"
          ? "What they can see has changed since this page loaded. Refresh the page to see it now, or remove their access."
          : "We could not save that just now. Nothing has changed. Please try again.",
      );
    },
  });

  const changed = keep.length !== row.categories.length;

  return (
    <li className="space-y-3 py-4">
      <div>
        <p className="text-sm font-medium">{row.first_name} can still see your health information.</p>
        {row.categories.length > 0 ? (
          <p className="mt-1 text-sm text-charcoal-ink/70">
            What they can see: {row.categories.map((c) => categoryLabel(c)).join(", ")}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-charcoal-ink/70">They can see what you have shared with them.</p>
        )}
        {row.days_overdue > 0 && (
          <p className="mt-1 text-xs text-charcoal-ink/60">This has been waiting a while. There is no rush, and nothing changes unless you choose.</p>
        )}
      </div>

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={answer.isPending} onClick={() => answer.mutate({ action: "keep" })}>
            Keep as it is
          </Button>
          {row.categories.length > 0 && (
            <Button type="button" size="sm" variant="outline" disabled={answer.isPending} onClick={() => setMode("narrowing")}>
              Let them see less
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" disabled={answer.isPending} onClick={() => setMode("confirming_remove")}>
            Remove their access
          </Button>
        </div>
      )}

      {mode === "narrowing" && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs text-charcoal-ink/60">
            Untick what they no longer need to see. They are not told. To stop all of it, choose &quot;Remove their access&quot; instead.
          </legend>
          {row.categories.map((category) => (
            <label key={category} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={keep.includes(category)}
                onChange={(event) =>
                  setKeep((current) => (event.target.checked ? [...current, category] : current.filter((c) => c !== category)))
                }
              />
              {categoryLabel(category)}
            </label>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" size="sm" disabled={!changed || keep.length === 0 || answer.isPending} onClick={() => answer.mutate({ action: "narrow" })}>
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={answer.isPending} onClick={() => setMode("idle")}>
              Back
            </Button>
          </div>
        </fieldset>
      )}

      {mode === "confirming_remove" && (
        <div className="space-y-2">
          <p className="text-sm">Remove {row.first_name}&apos;s access now? They will not be able to see anything of yours. They are not told.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={answer.isPending} onClick={() => answer.mutate({ action: "remove" })}>
              Yes, remove it
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={answer.isPending} onClick={() => setMode("idle")}>
              No, go back
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="text-sm text-charcoal-ink/80">
          {message}
        </p>
      )}
    </li>
  );
}

/**
 * The yearly check (NHS proxy-access standard: grant, redact, review, revoke). Shows every grant whose review is due, with the three answers.
 * Not answering never removes anything: the item simply stays here until the person answers.
 */
export function ProxyReviewCard() {
  const reviews = useMyProxyReviews();
  const [notices, setNotices] = useState<string[]>([]);
  if (reviews.isLoading) return null;
  if (reviews.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Yearly check on who can help you</CardTitle>
          <CardDescription>We could not load this just now. Please try again later. Nobody&apos;s access has changed.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const due = dueReviews(reviews.data ?? []);
  if (due.length === 0 && notices.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Yearly check on who can help you</CardTitle>
        <CardDescription>
          Once a year we ask whether the people who help you still need access. Nothing changes unless you choose.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {notices.map((notice, index) => (
          <p key={`${index}-${notice}`} role="status" className="pb-3 text-sm text-charcoal-ink/80">
            {notice}
          </p>
        ))}
        <ul className="divide-y divide-charcoal-ink/10">
          {due.map((row) => (
            <ReviewItem key={row.grant_id} row={row} onDone={(message) => setNotices((current) => [...current, message])} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
