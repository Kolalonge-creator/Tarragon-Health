"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { updateEmergencyContact } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Saves the patient's emergency contact + next of kin. If the patient reports
 * an emergency and doesn't respond within a few minutes, we automatically
 * message the emergency contact — so this number is what makes the "notify
 * someone if you're not responding" step possible. Optional but strongly
 * encouraged.
 */
export function EmergencyContactForm({
  initial,
}: {
  initial: {
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    emergency_contact_relationship: string | null;
    emergency_contact_consent: boolean | null;
    next_of_kin_name: string | null;
    next_of_kin_phone: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState(updateEmergencyContact, undefined);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Emergency contact &amp; next of kin
        </CardTitle>
        <CardDescription>
          If you ever report an emergency and don&apos;t respond, we&apos;ll message this person so
          they can reach you. Add a number you trust.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ec-name">Emergency contact name</Label>
              <Input
                id="ec-name"
                name="emergency_contact_name"
                placeholder="e.g. Ada Obi"
                defaultValue={initial.emergency_contact_name ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-phone">Emergency contact phone</Label>
              <Input
                id="ec-phone"
                name="emergency_contact_phone"
                inputMode="tel"
                placeholder="+2348012345678"
                defaultValue={initial.emergency_contact_phone ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-rel">Relationship (optional)</Label>
              <Input
                id="ec-rel"
                name="emergency_contact_relationship"
                placeholder="e.g. Spouse"
                defaultValue={initial.emergency_contact_relationship ?? ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nok-name">Next of kin name (optional)</Label>
              <Input
                id="nok-name"
                name="next_of_kin_name"
                placeholder="e.g. Emeka Obi"
                defaultValue={initial.next_of_kin_name ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nok-phone">Next of kin phone (optional)</Label>
              <Input
                id="nok-phone"
                name="next_of_kin_phone"
                inputMode="tel"
                placeholder="+2348012345678"
                defaultValue={initial.next_of_kin_phone ?? ""}
              />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input
              type="checkbox"
              name="emergency_contact_consent"
              defaultChecked={initial.emergency_contact_consent ?? false}
              className="mt-0.5 h-4 w-4 rounded border-charcoal-ink/30 accent-brand-green"
            />
            <span>
              I confirm this person has agreed to be contacted by TarragonHealth in an emergency,
              and I have their permission to share their details for this purpose.
            </span>
          </label>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Emergency contact saved.</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save emergency contact"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
