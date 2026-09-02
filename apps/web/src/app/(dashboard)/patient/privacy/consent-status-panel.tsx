"use client";

import { useCurrentConsentVersions, usePatientConsents } from "@/lib/queries/consent";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CONSENT_TYPE_LABEL: Record<string, string> = {
  data_processing: "Data processing",
  telehealth: "Telehealth",
  terms_of_service: "Terms of service",
  device_data: "Device & wearable data",
  marketing: "Marketing communications",
  research: "Research use",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Per-consent-type status, §87.6 — each type is its own row, not one
 * blanket "you agreed to our terms" line, matching the spec's explicit
 * "do not use one checkbox for everything" requirement.
 */
export function ConsentStatusPanel({ patientId }: { patientId: string }) {
  const currentVersions = useCurrentConsentVersions();
  const patientConsents = usePatientConsents(patientId);

  const versions = currentVersions.data ?? [];
  const accepted = patientConsents.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your consent</CardTitle>
        <CardDescription>What you&apos;ve agreed to, by category.</CardDescription>
      </CardHeader>
      <CardContent>
        {versions.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing to show yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {versions.map((version) => {
              const record = accepted.find(
                (c) => c.consent_type === version.consent_type && c.version === version.version
              );
              return (
                <li key={version.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {CONSENT_TYPE_LABEL[version.consent_type] ?? version.consent_type}
                    </p>
                    {record ? (
                      <p className="text-xs text-charcoal-ink/50">
                        Accepted {formatDate(record.accepted_at)} · v{version.version}
                      </p>
                    ) : (
                      <p className="text-xs text-charcoal-ink/50">Not yet recorded</p>
                    )}
                  </div>
                  <Badge variant={record ? "green" : "grey"}>
                    {record ? "Accepted" : "Outstanding"}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
