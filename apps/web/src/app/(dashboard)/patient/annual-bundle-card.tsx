"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { NIGERIAN_STATES } from "@/lib/nigeria-states";
import { usePatientLabOrders } from "@/lib/queries/lab-orders";
import {
  useAnnualBundleLabs,
  useAnnualBundleTowns,
  useStartAnnualBundle,
} from "@/lib/queries/annual-bundle";

type Mode = "partner" | "own";

/**
 * The annual test bundle, open to every patient on every plan, anywhere in Nigeria or abroad.
 * The patient asks for the bundle (never single tests), then either picks a partner lab near them
 * (state, then town, then an address to go to) or takes the printed request to a lab of their own.
 * Either way the patient pays the lab directly and uploads the result afterwards, through the
 * request card that appears in "Your test requests". An uploaded result goes through the same patient upload as any result: it is kept in the
 * record and read by the governed reader (AI-005) into a draft that a doctor files (OQ-BUNDLE-1). Tarragon-arranged blood collection is a
 * separate Membership Plus benefit, available only in states an admin has approved.
 */
export function AnnualBundleCard({ patientId }: { patientId: string }) {
  const { data: orders } = usePatientLabOrders(patientId);
  const start = useStartAnnualBundle(patientId);
  const [mode, setMode] = useState<Mode | null>(null);
  const [state, setState] = useState("");
  const [town, setTown] = useState("");
  const [locationId, setLocationId] = useState("");
  const [now] = useState(() => Date.now());

  const towns = useAnnualBundleTowns(state);
  const labs = useAnnualBundleLabs(state, town);

  const existing = orders?.find(
    (o) =>
      o.panel_code === "membership_annual" &&
      o.status !== "cancelled" &&
      o.status !== "sample_rejected" &&
      now - new Date(o.ordered_at).getTime() < 330 * 24 * 60 * 60 * 1000,
  );

  if (existing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your annual test bundle</CardTitle>
          <CardDescription>
            Your request is in &ldquo;Your test requests&rdquo; below. Download it, take it to the lab,
            then upload your result there when you have it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href={`/api/patient/lab-order/${existing.id}/request`}
            className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
          >
            Download the request form (PDF)
          </a>
        </CardContent>
      </Card>
    );
  }

  const chosenLab = labs.data?.find((l) => l.location_id === locationId);
  const canStart = mode === "own" || (mode === "partner" && Boolean(locationId));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Annual test bundle</CardTitle>
        <CardDescription>
          One set of blood tests, once a year, for everyone. Choose where you will do it. You pay the lab
          directly, then upload your result in \u201cYour test requests\u201d below so it is kept with your health record.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="sr-only">Where will you do the tests?</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="bundle-mode" checked={mode === "partner"} onChange={() => setMode("partner")} />
            <span>At a Tarragon partner lab near me</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="bundle-mode" checked={mode === "own"} onChange={() => setMode("own")} />
            <span>At any other lab near me (I will print the request form)</span>
          </label>
        </fieldset>

        {mode === "partner" && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="bundle-state">State</Label>
                <Select
                  id="bundle-state"
                  value={state}
                  onChange={(e) => {
                    setState(e.target.value);
                    setTown("");
                    setLocationId("");
                  }}
                >
                  <option value="">Choose your state…</option>
                  {NIGERIAN_STATES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="bundle-town">Town</Label>
                <Select
                  id="bundle-town"
                  value={town}
                  disabled={!state}
                  onChange={(e) => {
                    setTown(e.target.value);
                    setLocationId("");
                  }}
                >
                  <option value="">All towns</option>
                  {towns.data?.map((t) => (
                    <option key={t.town} value={t.town}>
                      {t.town}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {state && labs.isLoading && <p className="text-sm text-charcoal-ink/60">Looking for labs…</p>}
            {state && labs.isError && (
              <p className="text-sm text-red-600">Could not load labs. Please try again.</p>
            )}
            {state && labs.data && labs.data.length === 0 && (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                We have no partner lab in {state} yet. You can still do the bundle at any lab near you:
                choose the other option and print the request form.
              </p>
            )}
            {labs.data && labs.data.length > 0 && (
              <ul className="space-y-2" role="radiogroup" aria-label="Partner labs">
                {labs.data.map((l) => (
                  <li key={l.location_id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-charcoal-ink/10 p-3 text-sm">
                      <input
                        type="radio"
                        name="bundle-lab"
                        checked={locationId === l.location_id}
                        onChange={() => setLocationId(l.location_id)}
                      />
                      <span>
                        <span className="block font-medium">
                          {l.provider_name} {l.location_name}
                        </span>
                        <span className="block text-charcoal-ink/70 dark:text-night-ink/70">{l.address}</span>
                        {l.contact_phone && (
                          <span className="block text-xs text-charcoal-ink/60">{l.contact_phone}</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {start.isError && (
          <p className="text-sm text-red-600">
            We could not start your bundle. If you already started one this year it is in your test
            requests below. Otherwise please try again.
          </p>
        )}
        <Button
          disabled={!canStart || start.isPending}
          onClick={() => start.mutate(mode === "partner" ? locationId : null)}
        >
          {start.isPending
            ? "Starting…"
            : mode === "partner" && chosenLab
              ? `Get my request for ${chosenLab.location_name}`
              : "Get my request form"}
        </Button>
      </CardContent>
    </Card>
  );
}
