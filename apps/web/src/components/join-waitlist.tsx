"use client";

import { Button } from "@/components/ui/button";
import { useT } from "@/components/ui-language-provider";
import { useOnWaitlist, useSetWaitlist, type WaitlistFeature } from "@/lib/queries/feature-waitlist";

/**
 * Sits under a "not open yet" notice so a closed feature is never a dead end. It only records the person's interest; it promises no
 * message (none is sent yet), just that the page will change when it opens. While the state is unknown it shows nothing rather than
 * guessing, and a failed save says so.
 */
export function JoinWaitlist({ feature }: { feature: WaitlistFeature }) {
  const t = useT();
  const status = useOnWaitlist(feature);
  const set = useSetWaitlist(feature);

  if (status.isLoading || status.isError) return null;
  const joined = status.data === true;

  return (
    <div className="space-y-2">
      {joined ? <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("You are on the list. This page will change as soon as it opens.")}</p> : null}
      <Button
        type="button"
        size="sm"
        variant={joined ? "outline" : "default"}
        disabled={set.isPending}
        onClick={() => set.mutate(!joined)}
      >
        {joined ? t("Take me off the list") : t("Keep me on the list")}
      </Button>
      {set.isError ? <p role="alert" className="text-sm text-red-600 dark:text-red-300">{t("We could not save that just now. Please try again in a moment.")}</p> : null}
    </div>
  );
}
