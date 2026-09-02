import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * "Is this document real?" — asked by a board member, a regulator or an auditor
 * holding a printed outcomes report, who has no TarragonHealth account and
 * should not need one.
 *
 * NO LOGIN, BY DESIGN, and safe without one because the check needs BOTH
 * halves off the document: the report number and the full 64-character
 * verification code. The code is a SHA-256 fingerprint, so it cannot be
 * guessed, and the pair cannot be walked to enumerate an insurer's reporting
 * history the way a bare serial could.
 *
 * ⚠️ THIS PAGE NEVER SHOWS A FIGURE FROM THE REPORT. Not a rate, not a cohort
 * size, not a measure. The person here is already holding the numbers; what
 * they lack is proof, and proof is all this returns —
 * `verify_payer_board_report` is written so that no snapshot content can leave
 * through it however this page calls it. Same posture as
 * `emergency_card_by_token` and `health_passport_by_serial`.
 *
 * Rendered with a bare anon supabase-js client and no platform/auth imports,
 * holding the same boundary `app/emergency/[token]` holds: this page must not
 * be able to reach anything the two codes do not entitle.
 */

export const metadata: Metadata = {
  title: "Verify an outcomes report",
  description:
    "Confirm that a TarragonHealth outcomes report is genuine, and whether it is still current.",
  robots: { index: false, follow: false, nocache: true },
};

type VerifyResult = {
  verified: boolean;
  reason?: string;
  report_number?: string;
  issued_to?: string;
  period_start?: string;
  period_end?: string;
  generated_at?: string;
  status?: string;
  attested?: boolean;
  attested_by_name?: string | null;
  attested_at?: string | null;
  attester_role_title?: string | null;
  attestation_statement?: string | null;
  withdrawn?: boolean;
  withdrawal_reason?: string | null;
  superseded?: boolean;
  note?: string;
};

function fmtDate(d?: string | null) {
  if (!d) return null;
  return new Date(d.length === 10 ? d + "T00:00:00Z" : d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function VerifyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ number?: string; code?: string }>;
}) {
  const { number, code } = await searchParams;
  const submitted = Boolean(number && code);

  let result: VerifyResult | null = null;
  if (submitted) {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data } = await supabase.rpc("verify_payer_board_report", {
      p_report_number: number!.trim(),
      // Spaces are grouped into the printed code for legibility; strip them
      // back out rather than making somebody retype it without them.
      p_content_hash: code!.replace(/\s+/g, "").toLowerCase(),
    });
    result = (data as VerifyResult | null) ?? null;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="font-heading text-lg font-semibold text-deep-forest">TarragonHealth</p>
      <h1 className="mt-1 font-heading text-2xl font-semibold text-charcoal-ink">
        Verify an outcomes report
      </h1>
      <p className="mt-2 text-sm text-charcoal-ink/70">
        Enter the report number and the verification code printed in the footer of the document you
        are holding. This confirms whether the document is genuine and whether it is still current.
        It does not show any of the report&apos;s figures.
      </p>

      <form method="get" className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="number" className="block text-sm font-medium text-charcoal-ink">
            Report number
          </label>
          <input
            id="number"
            name="number"
            defaultValue={number ?? ""}
            required
            placeholder="TAR-XXXX-2026-0001"
            className="w-full rounded-md border border-charcoal-ink/25 px-3 py-2 font-mono text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="code" className="block text-sm font-medium text-charcoal-ink">
            Verification code
          </label>
          <textarea
            id="code"
            name="code"
            defaultValue={code ?? ""}
            required
            rows={2}
            placeholder="64 characters, spaces optional"
            className="w-full rounded-md border border-charcoal-ink/25 px-3 py-2 font-mono text-xs"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white"
        >
          Check this document
        </button>
      </form>

      {submitted && result && (
        <section
          className={`mt-8 rounded-lg border p-5 ${
            !result.verified
              ? "border-red-300 bg-red-50"
              : result.withdrawn
                ? "border-red-300 bg-red-50"
                : result.superseded || !result.attested
                  ? "border-amber-300 bg-amber-50"
                  : "border-green-300 bg-green-50"
          }`}
        >
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
            {result.verified ? "This document is genuine" : "No matching document"}
          </h2>
          <p className="mt-1 text-sm text-charcoal-ink/85">{result.note ?? result.reason}</p>

          {result.verified && (
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Report number">
                <span className="font-mono">{result.report_number}</span>
              </Row>
              <Row label="Issued to">{result.issued_to}</Row>
              <Row label="Reporting period">
                {fmtDate(result.period_start)} to {fmtDate(result.period_end)}
              </Row>
              <Row label="Generated">{fmtDate(result.generated_at)}</Row>
              {/* Null-gated: an unattested report says so in as many words. It
                  never renders a blank line a reader could read as signed. */}
              <Row label="Attested">
                {result.attested
                  ? `${result.attester_role_title ?? "TarragonHealth"}${
                      result.attested_by_name ? ` — ${result.attested_by_name}` : ""
                    }, ${fmtDate(result.attested_at)}`
                  : "Not attested — this is a draft and should not be treated as a final statement."}
              </Row>
              {result.attested && result.attestation_statement && (
                <Row label="Attestation">
                  <span className="italic">&ldquo;{result.attestation_statement}&rdquo;</span>
                </Row>
              )}
              {result.withdrawn && result.withdrawal_reason && (
                <Row label="Withdrawn because">{result.withdrawal_reason}</Row>
              )}
            </dl>
          )}
        </section>
      )}

      <p className="mt-8 text-xs text-charcoal-ink/55">
        The verification code is a SHA-256 fingerprint of the figures in the document. If a single
        character of any number in it had been changed, the code would not match and this page would
        find nothing.
      </p>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sm:flex sm:gap-3">
      <dt className="shrink-0 text-charcoal-ink/60 sm:w-40">{label}</dt>
      <dd className="text-charcoal-ink/90">{children}</dd>
    </div>
  );
}
