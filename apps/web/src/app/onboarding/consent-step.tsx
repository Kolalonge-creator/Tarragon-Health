"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useCurrentConsentVersions } from "@/lib/queries/consent";
import { acceptConsents } from "./actions";
import { Button } from "@/components/ui/button";
import { parseLegalSections } from "@/lib/legal/parse-sections";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

/** The full text of each consent type is also published publicly, unauthenticated. */
const PUBLIC_LEGAL_PATH: Record<string, string> = {
  data_processing: "/privacy",
  telehealth: "/telehealth-consent",
  terms_of_service: "/terms",
};

/**
 * Step 1 of onboarding. Renders the actual consent text (data processing,
 * remote care, terms) and records acceptance of every current version. This
 * is a hard gate — the profiles_enforce_onboarding_prereqs trigger blocks
 * finishing onboarding until these are on file.
 */
export function ConsentStep({
  onComplete,
  onlyTypes,
  description,
}: {
  onComplete: () => void;
  /**
   * Restricts which consents are shown and accepted. Used by the supporter
   * path, where telehealth and health-data consents are not merely skipped for
   * convenience — a person who will never receive care here has no telehealth
   * relationship to consent to, and we have no basis to process health data
   * they will never give us. Asking anyway would collect a consent that is not
   * true. The database enforces the same split in
   * private.enforce_onboarding_prereqs.
   */
  onlyTypes?: string[];
  description?: string;
}) {
  const { data: allVersions, isLoading } = useCurrentConsentVersions();
  const [state, formAction, pending] = useActionState(acceptConsents, undefined);
  const errorId = fieldErrorId("onboarding-consent");

  const versions = onlyTypes
    ? allVersions?.filter((v) => onlyTypes.includes(v.consent_type))
    : allVersions;

  useEffect(() => {
    if (state?.success) onComplete();
  }, [state?.success, onComplete]);

  return (
    <div className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
          Your agreement
        </h2>
        <p className="mt-1 text-sm text-charcoal-ink/60">
          {description ?? "Please read and agree before we set up your care."}
        </p>
      </div>

      {isLoading && (
        <p role="status" className="text-sm text-charcoal-ink/60">
          Loading…
        </p>
      )}

      <div className="space-y-3">
        {versions?.map((version) => {
          const sections = parseLegalSections(version.body);
          const publicPath = PUBLIC_LEGAL_PATH[version.consent_type];
          return (
            <details
              key={version.id}
              className="rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3"
            >
              <summary className="cursor-pointer text-sm font-semibold text-charcoal-ink">
                {version.title}
              </summary>
              <div className="mt-2 max-h-64 space-y-4 overflow-y-auto pr-1">
                {sections.map((section) => (
                  <div key={section.heading}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
                      {section.heading}
                    </p>
                    {section.paragraphs.map((p, i) => (
                      <p key={i} className="mt-1 text-sm leading-relaxed text-charcoal-ink/80">
                        {p}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
              {publicPath ? (
                <Link
                  href={publicPath}
                  target="_blank"
                  className="mt-3 inline-block text-xs text-brand-green underline hover:no-underline"
                >
                  Open in a new tab →
                </Link>
              ) : null}
            </details>
          );
        })}
      </div>

      <form action={formAction} className="space-y-3">
        <label className="flex items-start gap-2 text-sm text-charcoal-ink">
          <input
            type="checkbox"
            name="accept"
            className="mt-0.5 h-4 w-4 rounded border-charcoal-ink/30"
            required
            {...fieldErrorProps(errorId, Boolean(state?.error))}
          />
          {/* The wording has to match what is actually on the page. A
              supporter is shown only the terms of service, so claiming they
              agreed "to receive remote care" would record a consent they were
              never asked for — the exact untruth this split exists to avoid. */}
          <span>
            {onlyTypes
              ? "I have read and agree to the terms of service."
              : "I have read and agree to how my health information is used, to receive remote care, and to the terms of service."}
          </span>
        </label>
        <FormError id={errorId} message={state?.error} />
        <Button type="submit" disabled={pending || isLoading}>
          {pending ? "Saving…" : "I agree, continue"}
        </Button>
      </form>
    </div>
  );
}
