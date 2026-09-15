"use client";

import { useState } from "react";
import {
  useMyNavigationRequests,
  useCreateNavigationRequest,
  useSubmitNavigationRequestFeedback,
} from "@/lib/queries/navigation-requests";
import {
  NAVIGATION_REQUEST_CATEGORIES,
  NAVIGATION_REQUEST_CATEGORY_LABEL,
} from "@/lib/validation/navigation-requests";
import { NAVIGATION_REQUEST_STATUS_BADGE } from "@/lib/worklist/navigation-request-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { Enums } from "@tarragon/shared";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
  });
}

/** Patient closed-loop feedback -- five plain buttons rather than a star
 * widget, since this only needs to submit once per resolved request. */
function FeedbackPrompt({ requestId }: { requestId: string }) {
  const submitFeedback = useSubmitNavigationRequestFeedback();
  const [given, setGiven] = useState(false);

  if (given) {
    return <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">Thanks for letting us know.</p>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">How did we do?</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={submitFeedback.isPending}
          onClick={() =>
            submitFeedback.mutate(
              { requestId, rating: n },
              { onSuccess: () => setGiven(true) }
            )
          }
          className="flex h-6 w-6 items-center justify-center rounded-full border border-charcoal-ink/15 dark:border-night-ink/20 text-xs text-charcoal-ink/70 dark:text-night-ink/70 hover:border-brand-green hover:text-brand-green dark:hover:text-brand-green-bright"
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** Module 75 -- "I need help" (75.4) plus the patient's own request history
 * with the closed loop (75.18: issue -> owner -> action -> resolution ->
 * patient informed) made visible. Deliberately non-clinical: category
 * choices are all administrative, and a description that reads as clinical
 * is flagged server-side (private.classify_navigation_request) so a
 * navigator hands it to the care team rather than answering it themselves
 * -- see navigation_requests_resolved's badge below and 75.5. */
export function NavigationRequests({ patientId }: { patientId: string }) {
  const { data: requests, isLoading } = useMyNavigationRequests(patientId);
  const createRequest = useCreateNavigationRequest(patientId);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Enums<"navigation_request_category">>("appointment");
  const [description, setDescription] = useState("");
  const [isComplaint, setIsComplaint] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (description.trim().length < 10) {
      setError("Tell us a bit more about what you need");
      return;
    }
    createRequest.mutate(
      { category, description, isComplaint },
      {
        onSuccess: () => {
          setDescription("");
          setIsComplaint(false);
          setOpen(false);
        },
        onError: (err) => setError(err instanceof Error ? err.message : "Couldn't send that"),
      }
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.clinicianFollowUp className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
            Need help with something?
          </CardTitle>
          <CardDescription>
            Appointments, pharmacy, labs, insurance, referrals, payments, or anything else that
            isn&apos;t about your health itself -- a navigator will help you sort it out.
          </CardDescription>
        </div>
        {!open && (
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            I need help
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {open && (
          <div className="space-y-3 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-4">
            <div className="grid gap-2">
              <Label htmlFor="nav-request-category">What&apos;s this about?</Label>
              <Select
                id="nav-request-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as Enums<"navigation_request_category">)}
              >
                {NAVIGATION_REQUEST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {NAVIGATION_REQUEST_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nav-request-description">Tell us what&apos;s going on</Label>
              <Textarea
                id="nav-request-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="e.g. My pharmacy doesn't have my usual medicine in stock"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              <input
                type="checkbox"
                checked={isComplaint}
                onChange={(e) => setIsComplaint(e.target.checked)}
                className="h-4 w-4 rounded border-charcoal-ink/30 dark:border-night-ink/35"
              />
              This is a formal complaint
            </label>
            <div className="flex items-center gap-3">
              <Button type="button" disabled={createRequest.isPending} onClick={submit}>
                {createRequest.isPending ? "Sending…" : "Send"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              {error && <span className="text-sm text-red-600 dark:text-red-300">{error}</span>}
            </div>
          </div>
        )}

        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {!isLoading && (!requests || requests.length === 0) && !open && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            No requests yet -- if something about the app or your care admin is getting in the way, let
            us know above.
          </p>
        )}
        {requests && requests.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {requests.map((r) => {
              const statusBadge = NAVIGATION_REQUEST_STATUS_BADGE[r.status];
              return (
                <li key={r.id} className="space-y-1 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">
                      {NAVIGATION_REQUEST_CATEGORY_LABEL[r.category]}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {r.is_complaint && <Badge variant="amber">Complaint</Badge>}
                      <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                    </div>
                  </div>
                  <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{r.description}</p>
                  <p className="text-xs text-charcoal-ink/45 dark:text-night-ink/55">Sent {when(r.created_at)}</p>
                  {r.status === "resolved" && r.resolution_note && (
                    <p className="rounded-md bg-warm-ivory dark:bg-night-ink/10 p-2 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                      {r.resolution_note}
                    </p>
                  )}
                  {r.status === "resolved" && r.satisfaction_rating === null && (
                    <FeedbackPrompt requestId={r.id} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
