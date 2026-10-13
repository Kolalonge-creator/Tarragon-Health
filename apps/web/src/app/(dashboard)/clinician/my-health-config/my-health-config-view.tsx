"use client";

import { useActionState } from "react";
import { signMyHealthConfig } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type MyHealthConfigRow = { id: string; version: number; approved_at: string | null; created_at: string; config: unknown };

const FIELD_LABEL: Record<string, string> = {
  initials: "Name initials",
  blood_group: "Blood group",
  genotype: "Genotype",
  genotype_provenance: "How the blood group or genotype is known (told by the patient, or confirmed by a lab report)",
  allergies_on_file: "That allergies are on file (never which allergy)",
  emergency_contact_phone: "The emergency contact's phone number",
  unlock_hint: "The words \"Full record needs your unlock\"",
};

const TOUCH = "min-h-11";

export function MyHealthConfigView({ row, canSign }: { row: MyHealthConfigRow | null; canSign: boolean }) {
  const [state, action, pending] = useActionState(signMyHealthConfig, undefined);
  const signed = row?.approved_at != null;
  const cfg = (row?.config ?? {}) as { lock_screen_pass?: { default_enabled?: boolean; fields?: string[] } };
  const fields = cfg.lock_screen_pass?.fields ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={signed ? "green" : "amber"}>{signed ? `Signed ${new Date(row!.approved_at!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          {signed
            ? "The lock-screen and wallet pass may carry exactly the fields below, once the pass is switched on."
            : "Until this is signed, no lock-screen or wallet pass is made. The patient's own printed card is unaffected."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What the lock-screen pass may show</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="list-disc space-y-1 pl-5">
            {fields.map((f) => (
              <li key={f}>{FIELD_LABEL[f] ?? f}</li>
            ))}
          </ul>
          <p>
            No medicine, condition or allergen name, and no reading, ever appears on the lock screen. Those need the patient to unlock the phone.
            The pass is off for every patient until they turn it on ({cfg.lock_screen_pass?.default_enabled ? "currently on by default" : "off by default"}).
          </p>
          <p className="text-charcoal-ink/70">
            The sharing limits and the access-log setting in the same version are the founder&apos;s and counsel&apos;s to confirm, not yours; signing does not change them.
            Switching the pass on needs Apple and Google credentials and a separate go-live decision.
          </p>
        </CardContent>
      </Card>

      {canSign && row && !signed ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={row.id} />
          <p className="text-sm text-charcoal-ink/70">Signing records, under your own name, that you reviewed the field list above.</p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have reviewed the list of fields the lock-screen pass may show.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending}>Sign the field list</Button>
        </form>
      ) : null}
    </div>
  );
}
