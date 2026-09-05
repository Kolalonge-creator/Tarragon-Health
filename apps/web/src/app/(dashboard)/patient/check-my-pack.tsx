"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { checkMedicationPack } from "@/lib/medications/pack-actions";
import { NAFDAC_MAS, type PackCheckResult } from "@/lib/medications/pack-check";
import type { PackReading } from "@/lib/medications/pack-vision";

const VERDICT: Record<
  PackCheckResult["verdict"],
  { badge: "green" | "amber" | "grey"; label: string; body: string }
> = {
  matches_prescription: {
    badge: "green",
    label: "Matches your prescription",
    body: "The name and strength on this pack match what you were prescribed.",
  },
  strength_differs: {
    badge: "amber",
    label: "Different strength",
    body: "This is the right medicine but a different strength from the one on your record. That can be deliberate, but check before you take it.",
  },
  strength_unknown: {
    badge: "grey",
    label: "Right medicine",
    body: "This medicine is on your list. We do not have a strength recorded for it, so there was nothing to compare the pack against.",
  },
  not_on_your_list: {
    badge: "amber",
    label: "Not on your list",
    body: "We could not match this to any medicine currently on your record. That is expected for something bought over the counter.",
  },
  unreadable: {
    badge: "grey",
    label: "Could not read the pack",
    body: "Nothing legible enough to compare. Try again in better light, holding the camera straight on.",
  },
};

/**
 * "Is this the right box?"
 *
 * Patients buy from any pharmacy now, so nobody on the platform sees the pack.
 * This reads it back and compares it against what was prescribed.
 *
 * It deliberately makes NO claim about whether a pack is genuine. That question
 * belongs to NAFDAC's Mobile Authentication Service, which this points at every
 * time — including when the comparison comes back clean, because a matching
 * name and strength says nothing at all about authenticity.
 */
export function CheckMyPack() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<PackReading | null>(null);
  const [check, setCheck] = useState<PackCheckResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    setReading(null);
    setCheck(null);
    startTransition(async () => {
      const result = await checkMedicationPack(formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setReading(result.reading);
      setCheck(result.check);
      formRef.current?.reset();
    });
  }

  const verdict = check ? VERDICT[check.verdict] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check a medicine pack</CardTitle>
        <CardDescription>
          Photograph a pack you have just bought and we will read what is on it and compare it with
          what you were prescribed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form ref={formRef} action={onSubmit} className="space-y-2">
          <input
            type="file"
            name="photo"
            accept="image/*"
            capture="environment"
            required
            className="block w-full text-sm text-charcoal-ink/80 dark:text-night-ink/80 file:mr-3 file:rounded file:border-0 file:bg-brand-green file:px-3 file:py-1.5 file:text-sm file:text-white"
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Reading the pack…" : "Check this pack"}
          </Button>
        </form>

        {error ? <p className="text-sm text-red-600 dark:text-red-300">{error}</p> : null}

        {reading && check && verdict ? (
          <div className="space-y-3 rounded-lg border border-charcoal-ink/15 dark:border-night-ink/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={verdict.badge}>{verdict.label}</Badge>
              {reading.confidence === "low" ? (
                <span className="text-xs text-amber-700 dark:text-amber-300">the photo was hard to read</span>
              ) : null}
            </div>

            <p className="text-sm text-charcoal-ink/85 dark:text-night-ink/85">{verdict.body}</p>

            {check.verdict === "strength_differs" ? (
              <p className="rounded border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15 p-2 text-sm text-amber-900 dark:text-amber-300">
                The pack says {check.packStrength?.value}
                {check.packStrength?.unit}. Your record says {check.prescribedStrength?.value}
                {check.prescribedStrength?.unit} of {check.matchedDrugName}.{" "}
                <Link href="/patient/messages" className="font-medium underline">
                  Ask your care team before taking it
                </Link>
                .
              </p>
            ) : null}

            {reading.unreadable_reason ? (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{reading.unreadable_reason}</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <Row label="Name" value={reading.drug_name} />
                <Row label="Brand" value={reading.brand_name} />
                <Row label="Strength" value={reading.strength} />
                <Row label="Form" value={reading.form} />
                <Row label="Made by" value={reading.manufacturer} />
                <Row label="NAFDAC number" value={reading.nafdac_number} />
                <Row label="Expiry on pack" value={reading.expiry_printed} />
              </dl>
            )}

            {/* Shown on EVERY result, including a clean one. A matching name and
                strength says nothing whatsoever about whether a pack is real. */}
            <div className="rounded border border-charcoal-ink/15 dark:border-night-ink/20 bg-charcoal-ink/[0.02] dark:bg-night-ink/10 p-2">
              <p className="text-xs font-medium text-charcoal-ink dark:text-night-ink">
                Is it genuine? We cannot tell you that. NAFDAC can.
              </p>
              <p className="mt-1 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                {reading.has_scratch_panel
                  ? NAFDAC_MAS.howTo
                  : `We could not see a scratch panel on this pack. ${NAFDAC_MAS.howTo}`}
              </p>
              <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{NAFDAC_MAS.caveat}</p>
            </div>

            <p className="text-[0.65rem] text-charcoal-ink/50 dark:text-night-ink/55">
              We read this from your photo and did not keep the picture or the result.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-charcoal-ink/55 dark:text-night-ink/55">{label}</dt>
      <dd className="text-charcoal-ink dark:text-night-ink">{value}</dd>
    </>
  );
}
