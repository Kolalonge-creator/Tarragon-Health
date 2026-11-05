"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Database } from "@tarragon/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";
import { resetMfaFactorsAction } from "./actions";

type Fns = Database["public"]["Functions"];
export type EnrolledAccountRow = Fns["admin_mfa_enrolled_accounts"]["Returns"][number] & { roleLabel: string };
export type FactorResetRow = Fns["admin_mfa_factor_resets"]["Returns"][number];

const REASON_MIN = 20;

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
}

/**
 * Reset a lost authenticator for somebody else. Lists every account that has an authenticator (verified or a set-up in
 * progress); the reset itself, its guards and its audit live in public.admin_reset_mfa_factors.
 */
export function MfaResetPanel({
  accounts,
  resets,
  currentUserId,
  search,
}: {
  accounts: EnrolledAccountRow[];
  resets: FactorResetRow[];
  currentUserId: string;
  /** The name searched for, read by the page from ?q= and passed to the database search. */
  search: string;
}) {
  const [target, setTarget] = useState<EnrolledAccountRow | null>(null);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const shown = accounts;

  function reset(account: EnrolledAccountRow, why: string) {
    const formData = new FormData();
    formData.set("profileId", account.profile_id);
    formData.set("reason", why);
    startTransition(async () => {
      const result = await resetMfaFactorsAction(undefined, formData);
      setFeedback(result ?? null);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Reset a lost authenticator</CardTitle>
        <CardDescription>
          For somebody who has lost or replaced the phone with their authenticator app. The reset removes their two-factor
          sign-in, signs them out on every device (a device already open stops working within the hour), and tells them in the app and by email. They set up a new authenticator at their
          next sign-in. Confirm it is really them first (for example by a video call), and say how in the reason. Resetting an admin
          or the Chief Medical Officer needs your own two-factor sign-in. Your own account is reset from Profile &amp; settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback?.error ? (
          <p role="alert" className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{feedback.error}</p>
        ) : null}
        {feedback?.message ? (
          <p role="status" className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{feedback.message}</p>
        ) : null}

        {/* A plain GET form: the search runs in the database, so every account can be found, not just the first 200. */}
        <form method="get" className="flex gap-2">
          <Input name="q" aria-label="Search accounts by name" placeholder="Search by name" defaultValue={search} />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {accounts.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">
            {search ? "No account with an authenticator matches that name." : "Nobody has set up an authenticator yet, so there is nothing to reset."}
          </p>
        ) : (
          <>
            {accounts.length >= 200 ? (
              <p className="text-xs text-charcoal-ink/60">Showing the first 200. Search by name to find someone else.</p>
            ) : null}
            <ul className="divide-y divide-charcoal-ink/5">
              {shown.map((a) => (
                <li key={a.profile_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium text-charcoal-ink">{a.full_name ?? "Unnamed account"}</p>
                    <p className="text-charcoal-ink/60">
                      {a.roleLabel}
                      {a.verified_factors === 0 ? ", set-up not finished" : ""}
                      {a.last_reset_at ? `, last reset ${formatWhen(a.last_reset_at)}` : ""}
                    </p>
                  </div>
                  {a.profile_id === currentUserId ? (
                    <span className="text-xs text-charcoal-ink/50">You (use Profile &amp; settings)</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        setReason("");
                        setTarget(a);
                      }}
                    >
                      Reset
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {resets.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-charcoal-ink">Recent resets</p>
            <ul className="space-y-2 text-sm">
              {resets.map((r) => (
                <li key={`${r.reset_at}-${r.target_name}`} className="border-b border-charcoal-ink/5 pb-2 last:border-0">
                  <span className="font-medium">{r.target_name ?? "An account"}</span>, {formatWhen(r.reset_at)}
                  {r.reset_by_name ? ` by ${r.reset_by_name}` : ""}: {r.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={target !== null}
        title="Reset this person's two-factor sign-in?"
        description="Their authenticator stops working, they are signed out everywhere (within the hour on a device already open), and they are told. This cannot be undone; they set up a new authenticator at their next sign-in."
        confirmLabel="Reset two-factor sign-in"
        cancelLabel="Cancel"
        destructive
        confirmDisabled={reason.trim().length < REASON_MIN}
        onConfirm={() => {
          const who = target;
          setTarget(null);
          if (who) reset(who, reason);
        }}
        onCancel={() => setTarget(null)}
      >
        <ConfirmDialogFacts
          rows={[
            { label: "Account", value: target?.full_name ?? "" },
            { label: "Role", value: target?.roleLabel ?? "" },
          ]}
        />
        <Textarea
          aria-label="Why, and how you confirmed it is really them"
          placeholder="Why, and how you confirmed it is really them (at least 20 characters)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
      </ConfirmDialog>
    </Card>
  );
}
