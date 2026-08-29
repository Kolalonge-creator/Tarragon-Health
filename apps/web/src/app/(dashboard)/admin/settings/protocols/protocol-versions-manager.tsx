"use client";

import { useState } from "react";
import { useProtocolVersions, useCreateProtocolVersion } from "@/lib/queries/protocol-versions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function formatApprovedAt(approvedAt: string): string {
  return new Date(approvedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ProtocolVersionsManager() {
  const { data: versions, isLoading, isError } = useProtocolVersions();
  const create = useCreateProtocolVersion();

  const [protocolId, setProtocolId] = useState("");
  const [title, setTitle] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [contentText, setContentText] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [evidenceBasis, setEvidenceBasis] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [retirementDate, setRetirementDate] = useState("");
  const [applicablePopulation, setApplicablePopulation] = useState("");

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !versions) {
    return <p className="text-sm text-red-600">Could not load protocol versions.</p>;
  }

  const byProtocol = new Map<string, typeof versions>();
  for (const v of versions) {
    byProtocol.set(v.protocol_id, [...(byProtocol.get(v.protocol_id) ?? []), v]);
  }

  const canSubmit =
    protocolId.trim().length > 0 && title.trim().length > 0 && changeSummary.trim().length > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign a new protocol version</CardTitle>
          <CardDescription>
            protocol_id is a stable slug shared across versions of the same protocol; reuse an
            existing one (see below) to add a version to it, or pick a new one to start a
            protocol.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="protocol-id">protocol_id</Label>
              <Input
                id="protocol-id"
                placeholder="e.g. hypertension_escalation_thresholds"
                value={protocolId}
                onChange={(e) => setProtocolId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="e.g. Hypertension escalation thresholds"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="change-summary">Change summary</Label>
            <Input
              id="change-summary"
              placeholder="What changed and why, in one line"
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="content">Protocol content</Label>
            <Textarea
              id="content"
              rows={6}
              placeholder="The actual thresholds/rules/care plan template text"
              value={contentText}
              onChange={(e) => setContentText(e.target.value)}
            />
          </div>
          <div className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-warm-ivory/40 p-3">
            <p className="text-xs font-medium text-charcoal-ink/70">
              Registry fields (spec §31.4) — all optional
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="specialty">Specialty</Label>
                <Input
                  id="specialty"
                  placeholder="e.g. Cardiology (leave blank if it spans several)"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="applicable-population">Applicable population</Label>
                <Input
                  id="applicable-population"
                  placeholder="e.g. Adults with confirmed hypertension"
                  value={applicablePopulation}
                  onChange={(e) => setApplicablePopulation(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evidence-basis">Evidence basis</Label>
              <Input
                id="evidence-basis"
                placeholder="The guideline/evidence this version follows"
                value={evidenceBasis}
                onChange={(e) => setEvidenceBasis(e.target.value)}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="effective-date">Effective date</Label>
                <Input
                  id="effective-date"
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="review-date">Review date</Label>
                <Input
                  id="review-date"
                  type="date"
                  value={reviewDate}
                  onChange={(e) => setReviewDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="retirement-date">Retirement date</Label>
                <Input
                  id="retirement-date"
                  type="date"
                  value={retirementDate}
                  onChange={(e) => setRetirementDate(e.target.value)}
                />
              </div>
            </div>
          </div>
          {create.isError && (
            <p className="text-sm text-red-600">{(create.error as Error).message}</p>
          )}
          <Button
            disabled={!canSubmit || create.isPending}
            onClick={() => {
              create.mutate(
                {
                  protocolId: protocolId.trim(),
                  title: title.trim(),
                  changeSummary: changeSummary.trim(),
                  content: { text: contentText.trim() },
                  registry: {
                    specialty: specialty.trim() || undefined,
                    evidenceBasis: evidenceBasis.trim() || undefined,
                    effectiveDate: effectiveDate || undefined,
                    reviewDate: reviewDate || undefined,
                    retirementDate: retirementDate || undefined,
                    applicablePopulation: applicablePopulation.trim() || undefined,
                  },
                },
                {
                  onSuccess: () => {
                    setProtocolId("");
                    setTitle("");
                    setChangeSummary("");
                    setContentText("");
                    setSpecialty("");
                    setEvidenceBasis("");
                    setEffectiveDate("");
                    setReviewDate("");
                    setRetirementDate("");
                    setApplicablePopulation("");
                  },
                }
              );
            }}
          >
            {create.isPending ? "Signing…" : "Sign version"}
          </Button>
        </CardContent>
      </Card>

      {byProtocol.size === 0 && (
        <p className="text-sm text-charcoal-ink/60">No protocols signed yet.</p>
      )}

      {[...byProtocol.entries()].map(([id, protocolVersions]) => (
        <Card key={id}>
          <CardHeader>
            <CardTitle>{protocolVersions[0].title}</CardTitle>
            <CardDescription>{id}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-charcoal-ink/10">
              {protocolVersions.map((v) => (
                <li key={v.id} className="space-y-1 py-3">
                  <p className="text-sm font-medium text-charcoal-ink">
                    v{v.version_number}, {formatApprovedAt(v.approved_at)}
                  </p>
                  <p className="text-xs text-charcoal-ink/60">
                    Signed by {v.approved_by_staff?.full_name ?? "unknown"}
                    {v.approved_by_staff?.credential_type &&
                      v.approved_by_staff?.credential_number &&
                      ` · ${v.approved_by_staff.credential_type} ${v.approved_by_staff.credential_number}`}
                  </p>
                  <p className="text-sm text-charcoal-ink/80">{v.change_summary}</p>
                  {(v.specialty ||
                    v.applicable_population ||
                    v.evidence_basis ||
                    v.effective_date ||
                    v.review_date ||
                    v.retirement_date) && (
                    <dl className="grid gap-x-4 gap-y-0.5 text-xs text-charcoal-ink/60 sm:grid-cols-2">
                      {v.specialty && (
                        <div className="flex gap-1">
                          <dt className="font-medium">Specialty:</dt>
                          <dd>{v.specialty}</dd>
                        </div>
                      )}
                      {v.applicable_population && (
                        <div className="flex gap-1">
                          <dt className="font-medium">Population:</dt>
                          <dd>{v.applicable_population}</dd>
                        </div>
                      )}
                      {v.evidence_basis && (
                        <div className="flex gap-1 sm:col-span-2">
                          <dt className="font-medium">Evidence basis:</dt>
                          <dd>{v.evidence_basis}</dd>
                        </div>
                      )}
                      {v.effective_date && (
                        <div className="flex gap-1">
                          <dt className="font-medium">Effective:</dt>
                          <dd>{v.effective_date}</dd>
                        </div>
                      )}
                      {v.review_date && (
                        <div className="flex gap-1">
                          <dt className="font-medium">Review due:</dt>
                          <dd>{v.review_date}</dd>
                        </div>
                      )}
                      {v.retirement_date && (
                        <div className="flex gap-1">
                          <dt className="font-medium">Retired:</dt>
                          <dd>{v.retirement_date}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
