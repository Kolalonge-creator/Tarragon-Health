"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CLINICAL_CONFIG_LABEL,
  clinicalConfigSignState,
  clinicalConfigSourcesSchema,
  isHighRiskClinicalConfigKind,
  parseClinicalConfigContent,
  type ClinicalConfigVersionRow,
  type IndependentClinicalReviewRow,
} from "@tarragon/shared";
import { confirmClinicalConfigSourcesAction, signClinicalConfigVersionAction, type SignClinicalConfigState } from "./clinical-config-actions";

function ConfirmSourcesControl({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState<SignClinicalConfigState, FormData>(
    (_prev, formData) => confirmClinicalConfigSourcesAction(versionId, String(formData.get("note") ?? "")),
    undefined
  );
  return (
    <form action={action} className="mt-3 space-y-2">
      <label htmlFor={`note-${versionId}`} className="block text-sm font-medium">
        Which source documents did you open? (required)
      </label>
      <textarea
        id={`note-${versionId}`}
        name="note"
        required
        rows={2}
        className="w-full rounded-md border border-mist-grey/60 p-2 text-sm"
        placeholder="e.g. Opened the national hypertension guideline and ISH 2020 and checked every number."
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Confirm sources checked"}
      </Button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green">Recorded.</p>}
    </form>
  );
}

function SignControl({ row, reviews, highestSigned }: { row: ClinicalConfigVersionRow; reviews: IndependentClinicalReviewRow[]; highestSigned: number | null }) {
  const [state, action, pending] = useActionState<SignClinicalConfigState, FormData>(
    () => signClinicalConfigVersionAction(row.id),
    undefined
  );
  const gate = clinicalConfigSignState(row, reviews, highestSigned);
  return (
    <form action={action} className="mt-3 space-y-1">
      <Button type="submit" size="sm" disabled={pending || !gate.canSign}>
        {pending ? "Signing…" : "Sign & activate"}
      </Button>
      {!gate.canSign && <p className="text-sm text-charcoal-ink/70">Cannot be signed yet: {gate.reason}</p>}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green">Signed and now in force.</p>}
    </form>
  );
}

/** Renders any JSON value readably: scalars inline, lists as bullets, objects as labelled rows. */
function Value({ value }: { value: unknown }) {
  if (value === null) return <span className="italic text-amber-700">not supplied (CMO to supply)</span>;
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc space-y-0.5 pl-5">
        {value.map((v, i) => (
          <li key={i}>
            <Value value={v} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    return (
      <dl className="space-y-1">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[minmax(0,14rem)_1fr] gap-2">
            <dt className="text-xs text-charcoal-ink/60">{k.replaceAll("_", " ")}</dt>
            <dd className="text-sm">
              <Value value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{String(value)}</span>;
}

export function ClinicalConfigVersionsView({
  rows,
  reviews,
}: {
  rows: ClinicalConfigVersionRow[];
  reviews: IndependentClinicalReviewRow[];
}) {
  const highestSignedByKind = new Map<string, number>();
  for (const r of rows) {
    if (r.approved_at) highestSignedByKind.set(r.config_kind, Math.max(highestSignedByKind.get(r.config_kind) ?? 0, r.version));
  }
  // Newest unsigned drafts first; history (signed and retired) sits below.
  const sorted = [...rows].sort((a, b) => a.config_kind.localeCompare(b.config_kind) || b.version - a.version);

  return (
    <div className="space-y-4">
      {sorted.map((row) => {
        const reviewsForRow = reviews.filter((r) => r.config_version_id === row.id);
        const highest = highestSignedByKind.get(row.config_kind) ?? null;
        const contentOk = parseClinicalConfigContent(row.config_kind, row.content);
        const sources = clinicalConfigSourcesSchema.safeParse(row.sources);
        const high = isHighRiskClinicalConfigKind(row.config_kind);
        return (
          <Card key={row.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {CLINICAL_CONFIG_LABEL[row.config_kind]}, version {row.version}
                <Badge variant={row.status === "active" ? "green" : row.status === "draft" ? "amber" : "grey"}>
                  {row.status === "draft" ? "Draft, unsigned" : row.status === "active" ? "Signed, in force" : "Retired"}
                </Badge>
                <Badge variant={high ? "red" : "grey"}>{high ? "High risk" : "Medium risk"}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                Founder position: {row.founder_position} ({row.founder_position_date}).
              </p>
              {row.verify_against_source ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2">
                  <p>
                    Verify against source: confirm the guideline documents below were opened and every number checked.
                    Signing is blocked until the Chief Medical Officer records that.
                  </p>
                  {row.status === "draft" && <ConfirmSourcesControl versionId={row.id} />}
                </div>
              ) : (
                <p className="rounded-md border border-mist-grey/40 p-2">
                  Sources confirmed checked
                  {row.sources_confirmed_at ? ` on ${new Date(row.sources_confirmed_at).toLocaleDateString("en-GB")}` : ""}
                  {row.sources_confirmed_note ? `: ${row.sources_confirmed_note}` : ""}
                </p>
              )}
              {!contentOk && (
                <p className="rounded-md border border-red-300 bg-red-50 p-2 text-red-700">
                  This row does not match its expected shape. Do not sign it; the raw content is shown below.
                </p>
              )}
              <div className="rounded-md border border-mist-grey/40 p-3">
                {contentOk ? <Value value={row.content} /> : <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(row.content, null, 2)}</pre>}
              </div>
              <div>
                <p className="font-medium">Sources</p>
                {sources.success ? (
                  <ul className="list-disc pl-5">
                    {sources.data.map((s) => (
                      <li key={s.name}>
                        {s.name}{" "}
                        <span className="text-xs text-charcoal-ink/60">
                          ({s.verification === "register_title_only" ? "title and date only verified" : "from background knowledge, CMO to verify"})
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-red-700">Sources could not be read.</p>
                )}
              </div>
              <div>
                <p className="font-medium">Independent clinical review</p>
                {reviewsForRow.length === 0 ? (
                  <p className="text-charcoal-ink/70">{high ? "None recorded. Required before signing." : "None recorded (not required for this kind)."}</p>
                ) : (
                  <ul className="list-disc pl-5">
                    {reviewsForRow.map((r) => (
                      <li key={r.id}>
                        {r.outcome === "approved" ? "Approved" : "Changes requested"} by {r.reviewer_name} ({r.mdcn_number}) on{" "}
                        {new Date(r.reviewed_at).toLocaleDateString("en-GB")}
                        {r.note ? `: ${r.note}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {row.status === "draft" && <SignControl row={row} reviews={reviews} highestSigned={highest} />}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
