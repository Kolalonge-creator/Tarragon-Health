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
import { FormError, FormSuccess, fieldErrorId } from "@/components/ui/form-error";
import { SEMANTIC_ICON } from "@/lib/icons";
import { NIGERIAN_STATES } from "@/lib/nigeria-states";
import { useRemountOnActionResult } from "@/lib/forms/use-remount-on-action-result";

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
  const errorId = fieldErrorId("location");
  const successId = "location-success";

  // See useRemountOnActionResult's own comment: a transient save error (or,
  // just as much, a *successful* save) used to leave the visible fields
  // showing stale values, since React resets every uncontrolled field once
  // the action returns regardless of outcome. Remounting on every attempt is
  // what lets fresh defaultValues (from the server's echoed `values`,
  // returned on success too) actually apply. Unlike signup (which only ever
  // remounts on error, since success there swaps to a whole different
  // confirmation screen), this form remounts on success too, so focus needs
  // to land on whichever banner is actually showing.
  const attempt = useRemountOnActionResult(state, (s) => Boolean(s), state?.success ? successId : errorId);

  // `state.values` (the action's echo) must only win over `initial` for the
  // render(s) immediately after the submission that produced it — its job
  // is to repopulate a freshly-remounted field with what was just typed,
  // not to permanently shadow the server's own truth. `useActionState`'s
  // `state` never resets to undefined on its own, and this component is
  // never remounted by `router.refresh()` (only the Server Component tree
  // re-renders, handing this Client Component a fresh `initial` prop) — so
  // without clearing it, `values` would keep winning forever, including
  // over a *later*, legitimate external edit to this same profile (another
  // tab, a caregiver), silently overwriting it right back on the next save.
  // It would also permanently defeat the state-dropdown mismatch detector
  // below: once a canonical value is saved successfully, "on file, please
  // reselect" could never fire again even if a later out-of-band write
  // reintroduced a real mismatch. Cleared the moment a genuinely new
  // `initial` arrives, whatever caused it; a fresh submission's own echo
  // (checked second, so it wins if both change in the same render) always
  // takes priority over that.
  const [values, setValues] = useState(state?.values);
  // Also part of the remount key below: clearing `values` alone wouldn't be
  // enough on its own, since `defaultValue` on an already-mounted
  // uncontrolled input is inert to prop changes without a remount — a
  // genuinely new `initial.city` needs the DOM to actually re-read it, not
  // just have `values` stop shadowing it in a computation nothing re-runs.
  const [initialEpoch, setInitialEpoch] = useState(0);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setValues(undefined);
    setInitialEpoch((n) => n + 1);
  }
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    setValues(state?.values);
  }

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
  // Depends on `state` itself, not the derived `state?.success` boolean: two
  // successful saves in a row both have `success: true` (the same primitive,
  // on two different `state` objects), so a dependency array keyed on that
  // boolean wouldn't change between them and this effect would silently
  // skip the second refresh.
  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state, router]);

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
        <form key={`${attempt}-${initialEpoch}`} action={formAction} className="space-y-4">
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
          <FormError id={errorId} message={state?.error} />
          <FormSuccess id={successId} message={state?.success ? "Location saved." : undefined} />
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save location"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
