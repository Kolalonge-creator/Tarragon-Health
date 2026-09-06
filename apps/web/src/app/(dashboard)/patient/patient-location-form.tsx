"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { updatePatientLocation } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

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
        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="location-state">State</Label>
              <Input
                id="location-state"
                name="state"
                placeholder="e.g. Lagos"
                defaultValue={initial.state ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-city">City</Label>
              <Input
                id="location-city"
                name="city"
                placeholder="e.g. Ikeja"
                defaultValue={initial.city ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-area">Area (optional)</Label>
              <Input
                id="location-area"
                name="area"
                placeholder="e.g. Allen Avenue"
                defaultValue={initial.area ?? ""}
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
