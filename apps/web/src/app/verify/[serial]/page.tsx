import type { Metadata } from "next";
import Link from "next/link";
import { verifyPassportBySerial, type PassportVerification } from "@/lib/health-passport/verify";
import { shortDigest } from "@/lib/health-passport/credential";
import { IdentityCheck } from "./identity-check";

/**
 * The page a stranger opens.
 *
 * NO LOGIN, BY DESIGN. The entire commercial point of the Health Passport is
 * that an embassy clerk, an NHS receptionist, a Lagos emergency department or an
 * employer's HR officer can check it in the moment, with no account and no
 * relationship with TarragonHealth. Requiring them to sign up would kill the one
 * property that makes the document worth carrying.
 *
 * WHAT IS AND IS NOT HERE. No clinical content, ever — not a vital, not a
 * diagnosis, not a medicine. The verifier is holding the document; they do not
 * need us to repeat its contents, and repeating them would turn a reference in a
 * URL into a health-record disclosure. What this page answers is a question
 * about a document: is it genuine, is it current, and whose is it. Identity is
 * released in two stages (see IdentityCheck) so a leaked or guessed reference
 * names nobody.
 *
 * Rendered with no platform or auth imports at all, the same boundary the
 * emergency card holds — this page must not be *able* to reach anything the
 * reference does not entitle.
 */

export const metadata: Metadata = {
  title: "Verify a TarragonHealth record",
  description:
    "Confirm whether a TarragonHealth Health Passport is genuine, current, and which doctor attested it.",
  // Never indexed. A reference sitting in a search index would outlive any
  // revocation, and the page is meant to be reached from a document in someone's
  // hand, not from a search result.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

// Always fresh. A revoked or superseded passport must stop reporting as current
// on the very next request; a cached page would keep vouching for a document the
// patient has withdrawn.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * How each outcome is presented.
 *
 * Every one of these is a distinct, honest answer rather than a rounding to
 * valid/invalid. "Superseded" in particular: that document was genuinely issued
 * and is genuinely ours, and telling a consulate it was "invalid" would be both
 * untrue and, for the patient, quietly catastrophic.
 */
const VERDICT: Record<
  PassportVerification["verdict"],
  { tone: "good" | "warn" | "bad"; headline: string; detail: string }
> = {
  genuine: {
    tone: "good",
    headline: "Genuine and current",
    detail:
      "TarragonHealth issued this record, and it has not been altered since. It has not been withdrawn or replaced, and it is within its validity period.",
  },
  superseded: {
    tone: "warn",
    headline: "Genuine, but replaced by a newer record",
    detail:
      "TarragonHealth issued this document and it has not been altered. A more recent Health Passport has since been issued for the same person, so the information here may be out of date. Ask them for the current one.",
  },
  expired: {
    tone: "warn",
    headline: "Genuine, but past its validity date",
    detail:
      "TarragonHealth issued this document and it has not been altered. Health records age, so this one is no longer presented as current. Ask the holder for a newly issued copy.",
  },
  revoked: {
    tone: "bad",
    headline: "Withdrawn",
    detail:
      "This document was issued by TarragonHealth but has since been withdrawn, either by the patient or by their care team. Do not rely on it. If it was withdrawn because of a correction to the record, the patient can issue a corrected replacement.",
  },
  unverifiable: {
    tone: "bad",
    headline: "Could not be verified",
    detail:
      "A record with this reference exists, but its signature does not check out against our published signing key. Do not rely on this document. Please contact TarragonHealth before acting on it.",
  },
  not_found: {
    tone: "bad",
    headline: "No such record",
    detail:
      "We hold no Health Passport with this reference. The most likely explanation is a mistyped reference. Check it against the document, including the four groups of four characters. If it is correct as printed, this document was not issued by TarragonHealth.",
  },
};

const TONE_CLASS = {
  good: "border-brand-green/40 bg-brand-green/5",
  warn: "border-amber-500/40 bg-amber-50",
  bad: "border-red-500/40 bg-red-50",
} as const;

const TONE_TEXT = {
  good: "text-brand-green",
  warn: "text-amber-700",
  bad: "text-red-700",
} as const;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-charcoal-ink/10 py-2 last:border-0">
      <span className="text-sm text-charcoal-ink/60">{label}</span>
      <span className="text-sm font-medium text-charcoal-ink">{value}</span>
    </div>
  );
}

export default async function VerifyPassportPage({
  params,
}: {
  params: Promise<{ serial: string }>;
}) {
  const { serial } = await params;
  const result = await verifyPassportBySerial(decodeURIComponent(serial));
  const verdict = VERDICT[result.verdict];
  const found = result.verdict !== "not_found";

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-3 border-b border-charcoal-ink/10 pb-5">
        <div>
          <p className="text-lg font-semibold text-brand-green">TarragonHealth</p>
          <p className="text-sm text-charcoal-ink/60">Record verification</p>
        </div>
        <p className="font-mono text-sm text-charcoal-ink/70">
          {result.serial ?? decodeURIComponent(serial)}
        </p>
      </header>

      <section className={`rounded-xl border p-6 ${TONE_CLASS[verdict.tone]}`}>
        <p className={`text-xs font-semibold uppercase tracking-wider ${TONE_TEXT[verdict.tone]}`}>
          Verification result
        </p>
        <h1 className="mt-2 font-heading text-2xl font-semibold text-charcoal-ink">
          {verdict.headline}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/80">{verdict.detail}</p>
        {result.verdict === "unverifiable" && result.signatureDetail && (
          <p className="mt-3 font-mono text-xs text-red-700">
            Technical detail: {result.signatureDetail}
          </p>
        )}
      </section>

      {found && (
        <>
          <section className="mt-8">
            <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
              Who this record belongs to
            </h2>
            <div className="mt-3">
              <IdentityCheck serial={result.serial ?? serial} initial={result} />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
              Clinical attestation
            </h2>
            <div className="mt-3 rounded-lg border border-charcoal-ink/15 p-5">
              {result.attestation ? (
                <>
                  <p className="text-xl font-semibold text-charcoal-ink">
                    Dr. {result.attestation.doctorName}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-brand-green">
                    {result.attestation.credentialType} registration{" "}
                    {result.attestation.credentialNumber}
                  </p>
                  <p className="mt-2 text-sm text-charcoal-ink/70">
                    Reviewed this record and attested it on {formatDate(result.attestation.attestedAt)}.
                  </p>
                  {result.attestation.statement && (
                    <blockquote className="mt-3 border-l-2 border-brand-green pl-3 text-sm text-charcoal-ink/80">
                      {result.attestation.statement}
                    </blockquote>
                  )}
                  <p className="mt-3 text-xs text-charcoal-ink/50">
                    The doctor and registration number shown here are the ones recorded at the
                    moment of attestation, and are printed identically on the document itself.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-base font-semibold text-charcoal-ink">Not clinician-attested</p>
                  <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
                    This is a signed export of the health record TarragonHealth holds for this
                    person. The signature proves we issued it and that it has not been altered. It
                    is not a doctor&rsquo;s opinion, a medical examination, or a fitness-to-work or
                    fitness-to-travel statement. If your process needs a named, registered doctor to
                    attest the record, ask the holder to request an attested Health Passport from
                    their account.
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
              Document details
            </h2>
            <div className="mt-3 rounded-lg border border-charcoal-ink/15 px-5 py-2">
              <Field label="Issued by" value={`${result.issuer} (${result.issuerDomain})`} />
              <Field label="Reference" value={result.serial ?? "Unknown"} />
              <Field label="Issued" value={formatDate(result.issuedAt)} />
              <Field label="Valid until" value={formatDate(result.expiresAt)} />
              {result.revokedAt && <Field label="Withdrawn" value={formatDate(result.revokedAt)} />}
              <Field
                label="Document fingerprint"
                value={result.contentDigest ? shortDigest(result.contentDigest) : "Not available"}
              />
              <Field
                label="Signature"
                value={
                  result.signatureValid
                    ? `Verified (${result.signingAlgorithm ?? "Ed25519"}, key ${result.signingKid})`
                    : "Not verified"
                }
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-charcoal-ink/50">
              Compare the fingerprint above with the one printed on the first page of the document.
              If they match, the content of the copy you are holding is exactly what was issued.
            </p>
          </section>
        </>
      )}

      <section className="mt-10 rounded-lg bg-charcoal-ink/5 p-5">
        <h2 className="font-heading text-base font-semibold text-charcoal-ink">
          What this check does and does not tell you
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
          It tells you whether TarragonHealth issued the document, whether it has been altered,
          whether it is still current, and which doctor attested it, if any. It does not tell you
          what is in the record: the clinical content is in the document the holder gave you, and we
          do not repeat it here.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
          You can also verify a TarragonHealth document entirely on your own. Every one carries its
          full signed credential, and the matching public keys are published at{" "}
          <span className="font-mono">
            https://{result.issuerDomain}/.well-known/tarragon-passport-keys.json
          </span>
          . Nothing about that check depends on us being reachable.
        </p>
        <p className="mt-3 text-xs text-charcoal-ink/50">
          TarragonHealth operates no clinics. It is the coordination layer between patients, their
          doctors, labs and pharmacies, and this is the record it holds, issued in a form you can
          check. Questions about a specific document:{" "}
          <Link href="/contact" className="underline">
            contact us
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
