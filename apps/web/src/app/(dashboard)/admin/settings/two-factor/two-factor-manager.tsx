"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Database } from "@tarragon/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";
import { setTwoFactorRequirementAction } from "./actions";

type Fns = Database["public"]["Functions"];
export type TwoFactorGroupRow = Fns["admin_mfa_group_requirements"]["Returns"][number] & { label: string };
export type TwoFactorChangeRow = Fns["admin_mfa_group_requirement_changes"]["Returns"][number] & { label: string };

const NOTE_MIN = 20;

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
}

export function TwoFactorManager({
  groups,
  history,
  loadFailed,
}: {
  groups: TwoFactorGroupRow[];
  history: TwoFactorChangeRow[];
  loadFailed: boolean;
}) {
  const [feedback, setFeedback] = useState<{ id: string; error?: string; message?: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{ group: TwoFactorGroupRow; required: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(group: TwoFactorGroupRow, required: boolean) {
    const formData = new FormData();
    formData.set("role", group.role);
    formData.set("doctorTier", group.doctor_tier ?? "");
    formData.set("required", String(required));
    formData.set("note", notes[group.id] ?? "");
    // The confirmation dialog showed these numbers; the database switches the group on only if they still match the live ones.
    formData.set("seenUnenrolled", String(group.member_count - group.enrolled_count));
    formData.set("seenUnenrolledCmo", String(group.unenrolled_cmo_count));
    formData.set("seenUnenrolledAdmin", String(group.unenrolled_admin_count));
    startTransition(async () => {
      const result = await setTwoFactorRequirementAction(undefined, formData);
      setFeedback(result ? { id: group.id, ...result } : null);
      if (!result?.error) setNotes((prev) => ({ ...prev, [group.id]: "" }));
      router.refresh();
    });
  }

  if (loadFailed) {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
        The groups could not be loaded. Nothing has changed. Refresh the page to try again.
      </p>
    );
  }

  const onCount = groups.filter((g) => g.required).length;
  const unenrolled = confirming ? confirming.group.member_count - confirming.group.enrolled_count : 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-charcoal-ink/70">
        {onCount === 0
          ? "No group requires two-factor sign-in. It is optional for everyone."
          : `${onCount} group${onCount === 1 ? "" : "s"} require${onCount === 1 ? "s" : ""} two-factor sign-in.`}{" "}
        A group under Doctors narrows the switch to one doctor tier. To switch on a group you belong to, turn on two-factor
        sign-in for your own account in Profile &amp; settings and sign in with it first.
      </p>
      <p className="text-sm text-charcoal-ink/70">
        The phone app cannot set up or ask for the code yet. While a group is required, its members can use only the
        website (the app keeps its emergency features). Somebody who loses their phone can be reset below.
      </p>

      {groups.map((g) => {
        const note = notes[g.id] ?? "";
        const noteOk = note.trim().length >= NOTE_MIN;
        const missing = g.member_count - g.enrolled_count;
        return (
          <Card key={g.id}>
            <CardHeader>
              <CardTitle as="h2" className="flex flex-wrap items-center gap-2">
                {g.label}
                <Badge variant={g.required ? "green" : "grey"}>{g.required ? "Required" : "Optional"}</Badge>
              </CardTitle>
              <CardDescription>
                {g.enrolled_count} of {g.member_count} active account{g.member_count === 1 ? "" : "s"} have two-factor sign-in
                set up.
                {missing > 0 && g.unenrolled_cmo_count > 0 && " The Chief Medical Officer has not set it up yet."}
                {missing > 0 && g.unenrolled_admin_count > 0 &&
                  ` ${g.unenrolled_admin_count} admin${g.unenrolled_admin_count === 1 ? " has" : "s have"} not set it up yet.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {feedback?.id === g.id && feedback.error ? (
                <p role="alert" className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{feedback.error}</p>
              ) : null}
              {feedback?.id === g.id && feedback.message ? (
                <p role="status" className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{feedback.message}</p>
              ) : null}
              <p className="text-xs text-charcoal-ink/60">
                Version {g.version}, last changed {formatWhen(g.changed_at)}
                {g.changed_by_name ? ` by ${g.changed_by_name}` : ""}
                {g.change_note ? `: ${g.change_note}` : ""}
              </p>
              <Textarea
                aria-label={`Why two-factor sign-in is being made ${g.required ? "optional" : "required"} for ${g.label}`}
                placeholder={
                  g.required
                    ? "Why make it optional again (at least 20 characters)"
                    : "Why require it now (at least 20 characters)"
                }
                value={note}
                onChange={(e) => setNotes((prev) => ({ ...prev, [g.id]: e.target.value }))}
                rows={2}
              />
              <Button
                variant={g.required ? "outline" : "default"}
                disabled={pending || !noteOk}
                onClick={() => setConfirming({ group: g, required: !g.required })}
              >
                {g.required ? "Make optional" : "Require two-factor sign-in"}
              </Button>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Change history</CardTitle>
          <CardDescription>Every change, who made it, when, and why.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No changes yet. Every group is as it shipped: optional.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {history.map((c) => (
                <li key={`${c.label}-${c.version}`} className="border-b border-charcoal-ink/5 pb-2 last:border-0">
                  <span className="font-medium">{c.label}</span>: {c.required ? "required" : "optional"} (version {c.version}),{" "}
                  {formatWhen(c.changed_at)}
                  {c.changed_by_name ? ` by ${c.changed_by_name}` : ""}. {c.change_note}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.required ? "Require two-factor sign-in for this group?" : "Make two-factor sign-in optional again?"}
        description={
          confirming?.required
            ? unenrolled > 0
              ? `${unenrolled} account${unenrolled === 1 ? " has" : "s have"} not set up two-factor sign-in. They will be sent to Profile & settings to set it up the next time they open a page, and will not reach patient records until they do.`
              : "Everyone in this group has set it up already. From their next sign-in they must enter the code from their authenticator app."
            : "People in this group will no longer be asked to set it up. Anyone who already has it keeps using it."
        }
        confirmLabel={confirming?.required ? "Require it" : "Make optional"}
        cancelLabel="Cancel"
        destructive={false}
        onConfirm={() => {
          const target = confirming;
          setConfirming(null);
          if (target) submit(target.group, target.required);
        }}
        onCancel={() => setConfirming(null)}
      >
        <ConfirmDialogFacts
          rows={[
            { label: "Group", value: confirming?.group.label ?? "" },
            { label: "Accounts", value: confirming ? String(confirming.group.member_count) : "" },
            { label: "Without two-factor sign-in", value: String(unenrolled) },
            ...(confirming?.required && confirming.group.unenrolled_cmo_count > 0
              ? [{ label: "Includes", value: "The Chief Medical Officer" }]
              : []),
            ...(confirming?.required && confirming.group.unenrolled_admin_count > 0
              ? [{ label: "Includes", value: `${confirming.group.unenrolled_admin_count} admin(s)` }]
              : []),
            { label: "Reason recorded", value: confirming ? (notes[confirming.group.id] ?? "") : "" },
          ]}
        />
      </ConfirmDialog>
    </div>
  );
}
