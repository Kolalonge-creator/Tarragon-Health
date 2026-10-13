"use client";

import { useActionState, useState } from "react";
import { generateBackupCodesAction } from "./recovery-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { formatPatientDate } from "@/lib/format-date";

/**
 * Backup codes (S03b): ten single-use codes that get you back in with no phone and no email. Shown ONCE, here, right after
 * they are made; only a count is kept afterwards. Making new ones ends the old set at once.
 */
export function BackupCodesPanel({ total, remaining, generatedAt }: { total: number; remaining: number; generatedAt: string | null }) {
  const [state, action, pending] = useActionState(generateBackupCodesAction, undefined);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const showingCodes = Boolean(state?.codes) && !saved;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup codes</CardTitle>
        <CardDescription>
          Ten codes that each work once. If you lose your phone and cannot reach your email, a backup code lets you set a new password.
          Keep them somewhere safe and private, like a locked drawer. Anyone who has one and knows your email or number can use it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showingCodes ? (
          <div className="space-y-3">
            <p role="status" className="text-sm font-medium">
              Save these now. We cannot show them again.
            </p>
            <ul className="grid max-w-md grid-cols-2 gap-2 font-mono text-base" aria-label="Your backup codes">
              {state?.codes?.map((code) => (
                <li key={code} className="rounded-md border border-charcoal-ink/15 px-3 py-2">
                  {code}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText((state?.codes ?? []).join("\n"));
                }}
              >
                Copy
              </Button>
              <Button type="button" variant="outline" onClick={() => window.print()}>
                Print
              </Button>
              <Button type="button" onClick={() => setSaved(true)}>
                I have saved them
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-charcoal-ink/70" role="status">
              {total === 0
                ? "You have no backup codes yet."
                : `You have ${remaining} of ${total} codes left${generatedAt ? `, made on ${formatPatientDate(generatedAt)}` : ""}.`}
              {total > 0 && remaining <= 2 ? " Make a new set soon." : ""}
            </p>
            {confirming ? (
              <form
                action={(fd) => {
                  setSaved(false);
                  setConfirming(false);
                  action(fd);
                }}
                className="space-y-3"
              >
                <p className="text-sm">
                  {total > 0 ? "Making new codes stops every old code from working. " : ""}
                  We will tell you by email and in the app that new codes were made.
                </p>
                <div className="max-w-sm space-y-1.5">
                  <Label htmlFor="backup-codes-password">Your password, to check it is you</Label>
                  <PasswordInput id="backup-codes-password" name="password" autoComplete="current-password" required />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={pending}>
                    {pending ? "Making codes..." : "Make my codes"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
                {total === 0 ? "Make backup codes" : "Make new backup codes"}
              </Button>
            )}
            <FormError id="backup-codes-error" message={state?.error} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
