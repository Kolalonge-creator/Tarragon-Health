"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { consentStateFor } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { withdrawConsentAction } from "./consent-actions";
import { CONSENT_TYPE_LABEL, useOutstandingConsentTypes } from "@/lib/queries/consent";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConsentStep } from "@/app/onboarding/consent-step";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function consentTypeLabel(type: string): string {
  return CONSENT_TYPE_LABEL[type] ?? type.replace(/_/g, " ");
}

/**
 * Per-consent-type status, §87.6 — each type is its own row, not one
 * blanket "you agreed to our terms" line, matching the spec's explicit
 * "do not use one checkbox for everything" requirement.
 *
 * Also the one place an already-onboarded patient can close an outstanding
 * consent gap: onboarding's own ConsentStep only ever runs once, during
 * onboarding, so a consent_versions bump after that (a new version replacing
 * one the patient already accepted) had no acceptance UI anywhere on the
 * platform until this. Reuses ConsentStep itself, scoped via `onlyTypes` to
 * just the types that are actually outstanding for this patient right now —
 * never re-shows or re-records a type the patient is already current on.
 */
export function ConsentStatusPanel({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = React.useState(false);
  // Two taps: "Withdraw" arms a confirmation for that type, the second tap does it.
  const [confirmingWithdraw, setConfirmingWithdraw] = React.useState<string | null>(null);
  const [withdrawError, setWithdrawError] = React.useState<string | null>(null);
  const { versions, accepted, outstanding, isLoading } = useOutstandingConsentTypes(patientId);

  const outstandingTypes = outstanding.map((v) => v.consent_type);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("consent.status.title")}</CardTitle>
        <CardDescription>{t("consent.status.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {versions.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("consent.status.empty")}</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {versions.map((version) => {
              // consentStateFor mirrors the database: a withdrawal after an acceptance ends it. Reading "any matching
              // row" here used to show a withdrawn consent as Accepted.
              const state = consentStateFor(accepted, version);
              const record = accepted.find(
                (c) =>
                  c.consent_type === version.consent_type &&
                  c.version === version.version &&
                  c.action === "accepted"
              );
              const optional = version.is_optional === true;
              const subtitle =
                state === "granted" && record
                  ? t("consent.status.accepted_on", "en", { date: formatDate(record.accepted_at), version: version.version })
                  : state === "older_version"
                    ? t("consent.status.older_version")
                    : state === "withdrawn"
                      ? t("consent.status.withdrawn_note")
                      : optional
                        ? t("consent.status.not_shared")
                        : t("consent.status.not_recorded");
              const badgeVariant = state === "granted" ? "green" : state === "older_version" ? "amber" : "grey";
              const badgeText =
                state === "granted"
                  ? t("consent.status.badge.accepted")
                  : state === "withdrawn"
                    ? t("consent.status.badge.withdrawn")
                    : optional
                      ? t("consent.status.badge.not_shared")
                      : t("consent.status.badge.outstanding");
              return (
                <li key={version.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                      {consentTypeLabel(version.consent_type)}
                    </p>
                    <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{subtitle}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {optional && state === "granted" && (
                      confirmingWithdraw === version.consent_type ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            setWithdrawError(null);
                            const result = await withdrawConsentAction(version.consent_type);
                            setConfirmingWithdraw(null);
                            if (result?.error) setWithdrawError(result.error);
                            else void queryClient.invalidateQueries({ queryKey: ["patient-consents", patientId] });
                          }}
                        >
                          {t("consent.status.withdraw_confirm")}
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmingWithdraw(version.consent_type)}>
                          {t("consent.status.withdraw")}
                        </Button>
                      )
                    )}
                    <Badge variant={badgeVariant}>{badgeText}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {withdrawError && (
          <p role="alert" className="text-sm text-red-700">
            {withdrawError}
          </p>
        )}

        {accepted.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
              {t("consent.status.history")}
            </summary>
            <ul className="mt-2 space-y-1">
              {[...accepted]
                .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
                .map((c) => (
                  <li key={c.id} className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                    {formatDate(c.created_at)} · {c.action === "withdrawn" ? t("consent.status.history.withdrew") : t("consent.status.history.accepted")} {consentTypeLabel(c.consent_type)} · v{c.version}
                  </li>
                ))}
            </ul>
          </details>
        )}

        {!isLoading && outstandingTypes.length > 0 && !reviewing && (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
              {outstandingTypes.length === 1
                ? t("consent.status.review_one")
                : t("consent.status.review_many", "en", { count: outstandingTypes.length })}
            </p>
            <Button type="button" size="sm" onClick={() => setReviewing(true)}>
              {t("consent.status.review_button")}
            </Button>
          </div>
        )}

        {reviewing && outstandingTypes.length > 0 && (
          <div className="space-y-2">
            <ConsentStep
              onlyTypes={outstandingTypes}
              description={t("consent.status.review_intro")}
              agreementLabel={t("consent.status.review_agree", "en", { types: outstandingTypes.map(consentTypeLabel).join(", ") })}
              onComplete={() => {
                setReviewing(false);
                void queryClient.invalidateQueries({ queryKey: ["patient-consents", patientId] });
              }}
            />
            <button
              type="button"
              onClick={() => setReviewing(false)}
              className="text-xs font-medium text-charcoal-ink/60 underline underline-offset-2 hover:no-underline dark:text-night-ink/60"
            >
              {t("consent.status.not_now")}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
