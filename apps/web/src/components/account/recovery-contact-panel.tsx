"use client";

import { useActionState } from "react";
import { cancelContactRecoveryAction, proposeRecoveryContactAction, revokeRecoveryContactAction } from "./recovery-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";

export interface CircleChoice {
  memberId: string;
  name: string;
  relationship: string;
}

export interface RecoveryContactView {
  id: string;
  state: "proposed" | "accepted";
  contact_name: string | null;
  still_in_circle: boolean;
  since: string;
}

/**
 * Recovery contact (S03b). If you are ever locked out, this person can confirm it is really you. They never receive a link or a
 * code: after they confirm, there is a wait of a day for your safety, and then a one-time link goes to YOUR verified email (or a
 * code to YOUR verified phone). We tell you at every step, by email and in the app.
 */
export function RecoveryContactPanel({ current, members }: { current: RecoveryContactView | null; members: CircleChoice[] }) {
  const [proposeState, propose, proposing] = useActionState(proposeRecoveryContactAction, undefined);
  const [revokeState, revoke, revoking] = useActionState(revokeRecoveryContactAction, undefined);
  const [cancelState, cancel, cancelling] = useActionState(cancelContactRecoveryAction, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery contact</CardTitle>
        <CardDescription>
          Pick one person in your Care Circle who can confirm it is really you if you are ever locked out of your account. They never
          get a link or a code. After they confirm there is a wait of a day for your safety, and then a one-time link goes to your own
          verified email, or a code to your own verified phone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {current ? (
          <div className="space-y-3">
            <p className="text-sm" role="status">
              {current.state === "accepted"
                ? `${current.contact_name ?? "Your contact"} agreed to be your recovery contact.`
                : `Waiting for ${current.contact_name ?? "your contact"} to say yes.`}
              {!current.still_in_circle ? " They are no longer in your Care Circle, so this will not work until you choose someone else." : ""}
            </p>
            <form action={revoke}>
              <input type="hidden" name="id" value={current.id} />
              <Button type="submit" variant="outline" disabled={revoking}>
                Remove recovery contact
              </Button>
            </form>
            <form action={cancel}>
              <Button type="submit" variant="ghost" disabled={cancelling}>
                Stop a recovery that was not me
              </Button>
            </form>
            <FormError id="recovery-contact-revoke-error" message={revokeState?.error ?? cancelState?.error} />
            {cancelState?.ok ? <FormSuccess message="Any recovery that was waiting has been stopped." /> : null}
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">
            Add someone to your Care Circle first. Your recovery contact has to be a confirmed member.
          </p>
        ) : (
          <form action={propose} className="max-w-sm space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="recovery-contact-member">Who can confirm it is you?</Label>
              <Select id="recovery-contact-member" name="memberId" required defaultValue="">
                <option value="" disabled>
                  Choose someone
                </option>
                {members.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.name} ({m.relationship})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recovery-contact-password">Your password, to check it is you</Label>
              <PasswordInput id="recovery-contact-password" name="password" autoComplete="current-password" required />
            </div>
            <FormError id="recovery-contact-propose-error" message={proposeState?.error} />
            {proposeState?.ok ? <FormSuccess message="We asked them. It counts once they say yes." /> : null}
            <Button type="submit" disabled={proposing}>
              Ask them
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
