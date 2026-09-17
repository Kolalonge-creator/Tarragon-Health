"use client";

import { useActionState } from "react";
import { savePlatformCreditConfig, type PlatformCreditConfigState } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { koboToNaira } from "@tarragon/shared";

export type PlatformCreditConfigRow = {
  minTopupKobo: number;
  maxTopupKobo: number;
  suggestedAmountsKobo: number[];
  updatedAt: string;
};

export function PlatformCreditConfigManager({ config }: { config: PlatformCreditConfigRow }) {
  const [state, formAction, pending] = useActionState<PlatformCreditConfigState, FormData>(
    savePlatformCreditConfig,
    undefined,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top-up settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="max-w-xl space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="min_naira">Minimum top-up (₦)</Label>
              <Input
                id="min_naira"
                name="min_naira"
                type="number"
                step="1"
                min="0"
                defaultValue={koboToNaira(config.minTopupKobo)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="max_naira">Maximum top-up (₦)</Label>
              <Input
                id="max_naira"
                name="max_naira"
                type="number"
                step="1"
                min="0"
                defaultValue={koboToNaira(config.maxTopupKobo)}
                required
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="suggested_naira">Suggested amounts (₦, comma-separated)</Label>
            <Input
              id="suggested_naira"
              name="suggested_naira"
              defaultValue={config.suggestedAmountsKobo.map((k) => koboToNaira(k)).join(", ")}
              placeholder="10000, 20000, 50000, 100000"
              required
            />
            <p className="text-xs text-charcoal-ink/50">
              Shown as quick-pick buttons on a patient&apos;s dashboard, in the order you enter
              them. Up to 8 amounts, each between the minimum and maximum above.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
            {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
          </div>
          <p className="text-xs text-charcoal-ink/50">
            Last saved {new Date(config.updatedAt).toLocaleString("en-GB")}.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
