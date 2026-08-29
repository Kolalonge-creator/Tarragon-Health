"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createPreventionCampaignAction, type SaveCampaignState } from "./actions";

const EXAMPLE_ELIGIBILITY = JSON.stringify(
  { op: "in", field: "hypertension_tier", value: ["moderate", "high"] },
  null,
  2
);
const EXAMPLE_ACTIONS = JSON.stringify(
  [{ type: "screening_invite", detail: "Free blood pressure check at any partner pharmacy this month" }],
  null,
  2
);

export interface CampaignPopulationOption {
  id: string;
  name: string;
}

export function CampaignForm({ populations = [] }: { populations?: CampaignPopulationOption[] }) {
  const [state, action, pending] = useActionState<SaveCampaignState, FormData>(
    createPreventionCampaignAction,
    undefined
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New campaign</CardTitle>
        <CardDescription>
          Created as a draft, visible only to staff. Eligibility is evaluated per patient against
          their own profile and current risk tiers (e.g. field <code>hypertension_tier</code>) —
          never against another patient&apos;s data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="code">Code (URL-safe slug)</Label>
              <Input id="code" name="code" placeholder="heart-health-month-2026" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="Heart Health Month" required />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" maxLength={2000} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="population_id">Target population (optional)</Label>
            <select
              id="population_id"
              name="population_id"
              className="h-9 w-full rounded-md border border-charcoal-ink/20 bg-white px-2 text-sm"
              defaultValue=""
            >
              <option value="">None — use the eligibility rule below only</option>
              {populations.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-charcoal-ink/50">
              A population from{" "}
              <Link href="/clinician/populations" className="underline">
                Population health
              </Link>{" "}
              — its size shows up as this campaign&apos;s baseline once you save.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="starts_on">Starts on</Label>
              <Input id="starts_on" name="starts_on" type="date" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ends_on">Ends on (optional)</Label>
              <Input id="ends_on" name="ends_on" type="date" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="eligibility_rule_json">Eligibility rule (JSON)</Label>
            <Textarea
              id="eligibility_rule_json"
              name="eligibility_rule_json"
              defaultValue={EXAMPLE_ELIGIBILITY}
              rows={4}
              className="font-mono text-xs"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="actions_json">Actions (JSON array)</Label>
            <Textarea
              id="actions_json"
              name="actions_json"
              defaultValue={EXAMPLE_ACTIONS}
              rows={4}
              className="font-mono text-xs"
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save as draft"}
          </Button>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Saved. Activate it below when ready.</p>}
        </form>
      </CardContent>
    </Card>
  );
}
