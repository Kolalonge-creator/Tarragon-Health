"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { attestBloodProfile } from "@/app/(dashboard)/clinician/patients/[patientId]/blood-profile-actions";
import { BLOOD_ATTESTATION_TEXT } from "@/lib/clinical/blood-attestation";

const BLOOD_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"] as const;
const GENOTYPES = ["AA", "AS", "AC", "SS", "SC", "CC", "other"] as const;

/**
 * The patient's own path to getting a blood group and genotype onto their card.
 *
 * Two ways in and only two: their care team reads it off a lab report they have
 * uploaded, or they state it here and confirm what they are confirming. There
 * is no third, unsourced route — the database refuses one.
 *
 * The card labels an attested value differently from a lab-backed one, and this
 * form says so up front rather than letting someone discover it later.
 */
export function BloodAttestationForm({
  initial,
}: {
  initial: {
    bloodGroup: string | null;
    genotype: string | null;
    genotypeNote: string | null;
    provenance: string | null;
  } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [bloodGroup, setBloodGroup] = useState(initial?.bloodGroup ?? "");
  const [genotype, setGenotype] = useState(initial?.genotype ?? "");
  const [note, setNote] = useState(initial?.genotypeNote ?? "");
  const [attested, setAttested] = useState(false);

  const labBacked = initial?.provenance === "lab_document";

  function submit() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await attestBloodProfile({
        blood_group: bloodGroup || null,
        genotype: genotype || null,
        genotype_note: genotype === "other" ? note || null : null,
        attested,
      });
      if (result.error) setError(result.error);
      if (result.message) {
        setMessage(result.message);
        setOpen(false);
        setAttested(false);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Blood group and genotype</CardTitle>
        <CardDescription>
          The first thing on your emergency card, and often the most useful. In Nigeria your
          genotype in particular can change how you are treated straight away.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {initial && (initial.bloodGroup || initial.genotype) ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-charcoal-ink/15 p-3">
            <span className="text-sm font-medium text-charcoal-ink">
              {initial.bloodGroup ?? "Group not recorded"}
              {initial.genotype ? ` · Genotype ${initial.genotype}` : ""}
            </span>
            <Badge variant={labBacked ? "green" : "amber"}>
              {labBacked ? "Confirmed from your lab report" : "Your own confirmation"}
            </Badge>
          </div>
        ) : (
          <p className="text-sm text-charcoal-ink/70">
            Not recorded yet. Your card will simply say so.
          </p>
        )}

        {labBacked ? (
          <p className="text-xs text-charcoal-ink/60">
            Your care team recorded this from a lab report you uploaded, so it shows on your card as
            confirmed. To change it, upload a newer report.
          </p>
        ) : (
          <>
            <p className="text-sm text-charcoal-ink/80">
              The best way to get this on your card is to{" "}
              <Link href="/patient#labs" className="font-medium text-brand-green hover:underline">
                upload your lab result
              </Link>
              , and your care team will confirm it. If you do not have the report to hand, you can
              tell us yourself instead.
            </p>

            {!open ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                Tell us myself
              </Button>
            ) : (
              <div className="space-y-3 rounded-lg border border-charcoal-ink/15 p-3">
                <div className="flex flex-wrap gap-3">
                  <label className="text-sm">
                    <span className="block text-xs text-charcoal-ink/60">Blood group</span>
                    <select
                      value={bloodGroup}
                      onChange={(e) => setBloodGroup(e.target.value)}
                      className="mt-1 rounded border border-charcoal-ink/20 px-2 py-1 text-sm"
                    >
                      <option value="">I am not sure</option>
                      {BLOOD_GROUPS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="block text-xs text-charcoal-ink/60">Genotype</span>
                    <select
                      value={genotype}
                      onChange={(e) => setGenotype(e.target.value)}
                      className="mt-1 rounded border border-charcoal-ink/20 px-2 py-1 text-sm"
                    >
                      <option value="">I am not sure</option>
                      {GENOTYPES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {genotype === "other" ? (
                  <label className="block text-sm">
                    <span className="block text-xs text-charcoal-ink/60">Which one?</span>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="mt-1 w-full rounded border border-charcoal-ink/20 px-2 py-1 text-sm"
                    />
                  </label>
                ) : null}

                <div className="rounded border border-charcoal-ink/15 bg-charcoal-ink/[0.02] p-2">
                  <label className="flex items-start gap-2 text-xs text-charcoal-ink/85">
                    <input
                      type="checkbox"
                      checked={attested}
                      onChange={(e) => setAttested(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Please confirm:</span>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {BLOOD_ATTESTATION_TEXT.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </span>
                  </label>
                </div>

                {error ? <p className="text-sm text-red-600">{error}</p> : null}

                <div className="flex gap-2">
                  <Button type="button" size="sm" disabled={pending || !attested} onClick={submit}>
                    {pending ? "Saving…" : "Record this"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {message ? <p className="text-sm text-brand-green">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
