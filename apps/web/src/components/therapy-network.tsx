"use client";

import { useState } from "react";
import { koboToNaira, type Enums } from "@tarragon/shared";
import {
  useTherapyDirectory,
  useMyTherapySessions,
  useRequestTherapySession,
  type TherapyProvider,
} from "@/lib/queries/therapy";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * The independent therapy network.
 *
 * Tarragon does not employ these practitioners and this component must never
 * imply that it does. They are psychologists and psychiatrists on
 * specialist_providers whose registration Tarragon has verified; Tarragon takes
 * the booking and earns a commission on it. That is a different relationship
 * from the care team, and a patient choosing where to take something this
 * personal is entitled to know which one they are dealing with.
 *
 * Two things here are safety behaviour rather than UI:
 *
 *  1. A patient with an open crisis alert is refused by the database, and the
 *     refusal message is shown to them verbatim rather than swallowed. Hiding
 *     the button instead would leave someone in crisis staring at a page that
 *     silently does nothing.
 *  2. Psychiatry is labelled as needing a doctor's review BEFORE the request is
 *     made, not after it is refused. Someone should not discover the gate by
 *     hitting it.
 */

const MODALITY_LABEL: Record<Enums<"therapy_modality">, string> = {
  video: "Video",
  audio: "Voice call",
  in_person: "In person",
};

function ProviderRow({
  provider,
  organisationId,
  patientId,
}: {
  provider: TherapyProvider;
  organisationId: string;
  patientId: string;
}) {
  const request = useRequestTherapySession();
  const [modality, setModality] = useState<Enums<"therapy_modality">>(
    provider.supports_telemedicine ? "video" : "in_person"
  );

  const modalities: Enums<"therapy_modality">[] = [
    ...(provider.supports_telemedicine ? (["video", "audio"] as const) : []),
    ...(provider.supports_in_person ? (["in_person"] as const) : []),
  ];

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              {provider.name}
            </p>
            <Badge variant="grey">
              {provider.specialist_type === "psychiatry" ? "Psychiatrist" : "Psychologist"}
            </Badge>
            {provider.needs_doctor_approval ? (
              <Badge variant="amber">A doctor reviews this request first</Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            {[
              provider.qualifications?.join(", ") || null,
              provider.subspecialty,
              provider.years_of_experience ? `${provider.years_of_experience} years` : null,
              [provider.city, provider.state].filter(Boolean).join(", ") || null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {provider.clinical_interests?.length ? (
            <p className="mt-1 text-xs leading-relaxed text-charcoal-ink/60 dark:text-night-ink/60">
              {provider.clinical_interests.join(", ")}
            </p>
          ) : null}
          {provider.languages?.length ? (
            <p className="mt-1 text-xs text-charcoal-ink/50 dark:text-night-ink/50">
              Speaks {provider.languages.join(", ")}
            </p>
          ) : null}
          {/* Deliberately shown. A registration number is what lets somebody
              check this practitioner with the regulator before paying them,
              which is the only part of "we verified them" the person taking the
              risk can confirm for themselves. Founder decision, 2026-09-10. */}
          {provider.license_number ? (
            <p className="mt-1 text-xs text-charcoal-ink/45 dark:text-night-ink/45">
              {provider.license_type ?? "Registration"} {provider.license_number}, verifiable with
              the regulator
            </p>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          {provider.consultation_fee_kobo ? (
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              ₦{koboToNaira(provider.consultation_fee_kobo).toLocaleString("en-NG")}
              <span className="ml-1 text-xs font-normal text-charcoal-ink/55 dark:text-night-ink/55">
                a session
              </span>
            </p>
          ) : null}
          {modalities.length > 1 ? (
            <div className="mt-2 flex flex-wrap justify-end gap-1">
              {modalities.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setModality(option)}
                  className={`rounded-full px-2.5 py-1 text-xs transition ${
                    modality === option
                      ? "bg-brand-green text-white"
                      : "bg-charcoal-ink/[0.06] text-charcoal-ink/70 dark:bg-night-ink/10 dark:text-night-ink/70"
                  }`}
                >
                  {MODALITY_LABEL[option]}
                </button>
              ))}
            </div>
          ) : null}
          <Button
            size="sm"
            className="mt-2"
            disabled={request.isPending || !provider.id}
            onClick={() =>
              provider.id &&
              request.mutate({
                organisationId,
                patientId,
                providerId: provider.id,
                feeKobo: provider.consultation_fee_kobo ?? 0,
                modality,
              })
            }
          >
            {request.isPending ? "Requesting…" : "Request a session"}
          </Button>
        </div>
      </div>

      {/* Shown verbatim. Every message this can produce is written for a
          patient to read, including the crisis refusal, which is the one that
          matters most. */}
      {request.isError ? (
        <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs leading-relaxed text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {(request.error as Error).message}
        </p>
      ) : null}
      {request.isSuccess ? (
        <p className="mt-2 text-xs text-deep-forest dark:text-brand-green-bright">
          Requested. {provider.needs_doctor_approval
            ? "A doctor on your care team will review it and come back to you."
            : "They will confirm a time with you."}
        </p>
      ) : null}
    </li>
  );
}

export function TherapyNetwork({
  organisationId,
  patientId,
}: {
  organisationId: string;
  patientId: string;
}) {
  const [telemedicineOnly, setTelemedicineOnly] = useState(false);
  const [type, setType] = useState<Enums<"specialist_type"> | undefined>(undefined);
  const { data: providers, isLoading, isError } = useTherapyDirectory({
    specialistType: type,
    telemedicineOnly,
  });
  const { data: sessions } = useMyTherapySessions();

  const openSessions = (sessions ?? []).filter((session) =>
    ["requested", "awaiting_clinician_approval", "confirmed"].includes(session.status)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.mood className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          See an independent therapist
        </CardTitle>
        <CardDescription>
          Psychologists and psychiatrists in private practice whose registration we have checked.
          They do not work for Tarragon; we verify them, take the booking, and keep it on your
          record. You pay their fee.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {openSessions.length > 0 ? (
          <ul className="space-y-2 rounded-lg bg-soft-sage/40 p-3">
            {openSessions.map((session) => (
              <li key={session.id} className="text-xs text-charcoal-ink/75 dark:text-night-ink/75">
                {session.status === "awaiting_clinician_approval"
                  ? "Waiting for a doctor on your care team to review this request."
                  : session.status === "confirmed"
                    ? "Session confirmed."
                    : "Request sent. They will be in touch."}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {(
            [
              { label: "Everyone", value: undefined },
              { label: "Psychologists", value: "psychology" as const },
              { label: "Psychiatrists", value: "psychiatry" as const },
            ] as const
          ).map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setType(option.value)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                type === option.value
                  ? "bg-clinical-navy text-white"
                  : "bg-charcoal-ink/[0.06] text-charcoal-ink/70 dark:bg-night-ink/10 dark:text-night-ink/70"
              }`}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTelemedicineOnly((value) => !value)}
            className={`rounded-full px-3 py-1 text-xs transition ${
              telemedicineOnly
                ? "bg-clinical-navy text-white"
                : "bg-charcoal-ink/[0.06] text-charcoal-ink/70 dark:bg-night-ink/10 dark:text-night-ink/70"
            }`}
          >
            Online only
          </button>
        </div>

        {isLoading && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>
        )}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Could not load the network just now.
          </p>
        )}
        {!isLoading && !isError && (providers ?? []).length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            No verified practitioners match that yet. We only list people whose registration we
            have checked, so this list grows slowly on purpose.
          </p>
        )}

        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {(providers ?? []).map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              organisationId={organisationId}
              patientId={patientId}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
