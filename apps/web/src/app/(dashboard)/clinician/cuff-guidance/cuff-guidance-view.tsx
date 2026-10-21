"use client";

import { useActionState } from "react";
import { t, type MessageKey } from "@tarragon/i18n";
import type { CuffGuidanceVersion } from "@/lib/home-bp/read-cuff-guidance";
import { signCuffGuidance } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TOUCH = "min-h-11";
const WORDS = ["hc.cuff.device", "hc.cuff.fit", "hc.cuff.battery", "hc.cuff.arm", "hc.cuff.no_wrist", "hc.cuff.pregnancy", "hc.cuff.size_intro", "hc.cuff.size_result"] as const;

function ConfigCard({ v, heading }: { v: CuffGuidanceVersion; heading: string }) {
  const c = v.config;
  if (!c) return <p role="alert" className="text-sm text-red-700">Version {v.version} does not pass the configuration check and cannot be signed.</p>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{heading} (version {v.version})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <table className="w-full">
          <caption className="text-left font-medium">Arm circumference to cuff size (whole centimetres, rounded half up)</caption>
          <tbody>
            {c.sizes.map((s) => (
              <tr key={s.key} className="border-t">
                <th scope="row" className="py-1 pr-3 text-left font-normal">{s.minCm} to {s.maxCm} cm</th>
                <td>{t(`hc.cuff.size.${s.key}` as MessageKey, "en")}</td>
              </tr>
            ))}
            <tr className="border-t">
              <th scope="row" className="py-1 pr-3 text-left font-normal">Outside the table</th>
              <td>The patient is told to ask her care team. No size is suggested.</td>
            </tr>
            <tr className="border-t">
              <th scope="row" className="py-1 pr-3 text-left font-normal">Measurements accepted</th>
              <td>{c.measureMinCm} to {c.measureMaxCm} cm (anything else is refused as a typing slip)</td>
            </tr>
          </tbody>
        </table>
        <p>Sources: AHA 2019 and ESH 2023 cuff-size tables, to be checked by you against the Nigerian guideline (NG-2023 section 3.1.1). See docs/research/S07y.md.</p>
        <div>
          <p className="font-medium">The wording the patient reads with it</p>
          <ul className="list-disc pl-5">
            {WORDS.map((k) => (
              <li key={k}>{t(k, "en")}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export function CuffGuidanceView({ live, pending, canSign }: { live: CuffGuidanceVersion | null; pending: CuffGuidanceVersion | null; canSign: boolean }) {
  const [state, action, pending_] = useActionState(signCuffGuidance, undefined);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={live ? "green" : "amber"}>{live ? `Signed ${new Date(live.approvedAt!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          {live
            ? "The cuff size step shows inside the home check."
            : "Until this is signed the home check shows no cuff size step and nobody can record a cuff. The older cuff guide (C4) is signed separately."}
        </p>
      </div>

      {live ? <ConfigCard v={live} heading="Signed and in force" /> : null}
      {pending ? <ConfigCard v={pending} heading="Waiting for your signature" /> : null}
      {!live && !pending ? <p className="text-sm">There is no version to sign.</p> : null}

      {canSign && pending && pending.config ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={pending.id} />
          <p className="text-sm text-charcoal-ink/70">Signing records, under your own name, that you checked the sizes and the wording above.</p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have checked the cuff sizes against the sources and read the wording.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending_}>Sign the cuff size guidance</Button>
        </form>
      ) : null}
    </div>
  );
}
