"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { updatePatientLocation } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { NIGERIAN_STATES } from "@/lib/nigeria-states";

/**
 * Saves the patient's state/city/area. Nearby-facility pickers (labs,
 * vaccination centres, pharmacies) that would have used this are suspended
 * platform-wide (founder decision 2026-08-03, see vaccination-booking.tsx) —
 * this just gets the location on file for when a partner is contracted and
 * they're re-enabled. Entirely optional today.
 */
export function PatientLocationForm({
  initial,
}: {
  initial: { state: string | null; city: string | null; area: string | null };
}) {
  const [state, formAction, pending] = useActionState(updatePatientLocation, undefined);
  const router = useRouter();

  // React resets every uncontrolled field in this action-bound <form> once
  // the action returns, success OR failure (see signup-form.tsx's fix for
  // the same behavior) — so a transient save error could otherwise wipe out
  // city/area/state edits the patient had just typed, not just fail to save
  // them. Re-keying the form on every attempt forces a remount, which is
  // what lets fresh defaultValues (from the server's echoed `values`,
  // returned on success too) actually apply — without this, a *successful*
  // save could flash the visible fields back to their stale pre-edit values
  // for the moment before router.refresh() lands a fresh `initial` prop,
  // looking like the edit was silently lost even though it wasn't.
  const [attempt, setAttempt] = useState(0);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state) setAttempt((n) => n + 1);
  }
  const values = state?.values;
  const currentState = values?.state ?? initial.state;

  // The state field used to be free text (see the Select comment below), so
  // an existing profile can carry a value that isn't an exact match for any
  // NIGERIAN_STATES option (different casing, "FCT" instead of "Abuja",
  // etc.). A <Select> with no matching <option> silently falls back to the
  // first one ("Select…") — if the patient then saved the form without
  // touching this field, that blank submission would have nulled out their
  // real saved state. Keeping the on-file value as its own option instead
  // preserves it (and makes the mismatch visible) until they pick a real one.
  const hasCanonicalMatch = !currentState || NIGERIAN_STATES.some((s) => s.value === currentState);

  // Server components read profiles.state/city/area — refresh so the pickers
  // downstream pick up the new saved location without a full reload.
  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.corporate className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Your location
        </CardTitle>
        <CardDescription>
          Save where you are. We&apos;ll use it to show nearby labs, vaccination centres, and
          pharmacies as soon as that&apos;s available in your area.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form key={attempt} action={formAction} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="location-state">State</Label>
              {/* A free-text field here previously let a typo or casing
                  mismatch silently break region-gated availability — see
                  the "value MUST match... exactly" warning in
                  nigeria-states.ts. Same canonical list the signup form
                  already uses. */}
              <Select id="location-state" name="state" defaultValue={currentState ?? ""}>
                <option value="">Select…</option>
                {!hasCanonicalMatch && (
                  <option value={currentState ?? ""}>{currentState} (on file, please reselect)</option>
                )}
                {NIGERIAN_STATES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-city">City</Label>
              <Input
                id="location-city"
                name="city"
                placeholder="e.g. Ikeja"
                defaultValue={values?.city ?? initial.city ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-area">Area (optional)</Label>
              <Input
                id="location-area"
                name="area"
                placeholder="e.g. Allen Avenue"
                defaultValue={values?.area ?? initial.area ?? ""}
              />
            </div>
          </div>
          {state?.error && <p className="text-sm text-red-600 dark:text-red-300">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green dark:text-brand-green-bright">Location saved.</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save location"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
