"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  issuePassportAction,
  requestAttestationAction,
  revokePassportAction,
  withdrawAttestationAction,
} from "@/lib/health-passport/actions";
import { formatPassportDate } from "@/lib/health-passport/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface PassportSummary {
  id: string;
  serial: string;
  status: "valid" | "superseded" | "revoked";
  issuedAt: string;
  expiresAt: string;
  verifyUrl: string;
  verificationCount: number;
  lastVerifiedAt: string | null;
  attestingDoctorName: string | null;
  attestingCredentialType: string | null;
  attestingCredentialNumber: string | null;
  isExpired: boolean;
}

export interface AttestationSummary {
  id: string;
  status: "pending" | "attested" | "declined" | "withdrawn";
  purpose: string;
  requestedAt: string;
  reviewedAt: string | null;
  declineReason: string | null;
  /** Already used by an issued passport, so it cannot be applied again. */
  used: boolean;
}

const STATUS_COPY: Record<string, { label: string; tone: string; detail: string }> = {
  valid: {
    label: "Current",
    tone: "text-brand-green",
    detail: "Anyone you give this to can check it and will be told it is genuine and current.",
  },
  superseded: {
    label: "Replaced",
    tone: "text-charcoal-ink/50",
    detail:
      "You issued a newer passport after this one. Anyone checking this copy is told it is genuine but has been replaced.",
  },
  revoked: {
    label: "Withdrawn",
    tone: "text-red-700",
    detail: "Anyone checking this copy is told not to rely on it.",
  },
  expired: {
    label: "Expired",
    tone: "text-amber-700",
    detail: "Past its validity date. Issue a new one if someone still needs it.",
  },
};

function PassportRow({ passport }: { passport: PassportSummary }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: async () => {
      const result = await revokePassportAction(passport.id, reason.trim() || null);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setError(null);
      setConfirming(false);
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const statusKey =
    passport.status === "valid" && passport.isExpired ? "expired" : passport.status;
  const status = STATUS_COPY[statusKey];
  const live = passport.status === "valid" && !passport.isExpired;

  return (
    <li className="space-y-2 border-b border-charcoal-ink/10 py-4 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-sm font-semibold text-charcoal-ink">{passport.serial}</p>
        <span className={`text-xs font-semibold uppercase tracking-wider ${status.tone}`}>
          {status.label}
        </span>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        Issued {formatPassportDate(passport.issuedAt)} · valid until {formatPassportDate(passport.expiresAt)}
      </p>
      {passport.attestingDoctorName && (
        <p className="text-xs text-brand-green">
          Attested by Dr. {passport.attestingDoctorName}
          {passport.attestingCredentialType && passport.attestingCredentialNumber
            ? ` · ${passport.attestingCredentialType} ${passport.attestingCredentialNumber}`
            : ""}
        </p>
      )}
      <p className="text-xs text-charcoal-ink/60">{status.detail}</p>

      {/* Who has looked. This is the patient's own oversight of a document that,
          by design, travels out of their hands. */}
      <p className="text-xs text-charcoal-ink/50">
        {passport.verificationCount === 0
          ? "Nobody has checked this yet."
          : `Checked ${passport.verificationCount} time${passport.verificationCount === 1 ? "" : "s"}${
              passport.lastVerifiedAt ? `, most recently ${formatPassportDate(passport.lastVerifiedAt)}` : ""
            }.`}
      </p>

      {live && (
        <div className="pt-1">
          {confirming ? (
            <div className="space-y-2">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional, kept for your own record)"
                className="max-w-sm"
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => revoke.mutate()}
                  disabled={revoke.isPending}
                >
                  Yes, withdraw it
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </div>
              <p className="text-xs text-charcoal-ink/60">
                Withdrawing is immediate and cannot be undone. Anyone holding the PDF will be told
                it has been withdrawn the next time they check it.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-xs font-medium text-red-700 underline"
            >
              Withdraw this passport
            </button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </li>
  );
}

export function PassportManager({
  passports,
  attestations,
  signingAvailable,
}: {
  passports: PassportSummary[];
  attestations: AttestationSummary[];
  /**
   * False when the deployment has no signing key. The UI says so plainly rather
   * than offering a button that would fail — and the plain summary download
   * stays available either way.
   */
  signingAvailable: boolean;
}) {
  const router = useRouter();
  const [purpose, setPurpose] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = passports.find((p) => p.status === "valid" && !p.isExpired) ?? null;
  const pending = attestations.find((a) => a.status === "pending") ?? null;
  const readyAttestation = attestations.find((a) => a.status === "attested" && !a.used) ?? null;

  const issue = useMutation({
    mutationFn: async (attestationId: string | null) => {
      const result = await issuePassportAction(attestationId);
      if (result.error) throw new Error(result.error);
      return result.message ?? "Issued.";
    },
    onSuccess: (m) => {
      setError(null);
      setMessage(m);
      router.refresh();
    },
    onError: (e: Error) => {
      setMessage(null);
      setError(e.message);
    },
  });

  const request = useMutation({
    mutationFn: async () => {
      const result = await requestAttestationAction(purpose, note || null);
      if (result.error) throw new Error(result.error);
      return result.message ?? "Requested.";
    },
    onSuccess: (m) => {
      setError(null);
      setMessage(m);
      setPurpose("");
      setNote("");
      router.refresh();
    },
    onError: (e: Error) => {
      setMessage(null);
      setError(e.message);
    },
  });

  const withdraw = useMutation({
    mutationFn: async (id: string) => {
      const result = await withdrawAttestationAction(id);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => router.refresh(),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your verifiable passport</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!signingAvailable && (
            <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900">
              Verified passports are not switched on here yet. You can still download your health
              summary below, but it will not carry a reference someone else can check.
            </p>
          )}

          {current ? (
            <div className="rounded-lg border border-brand-green/40 bg-brand-green/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">
                Current passport
              </p>
              <p className="mt-1 font-mono text-lg font-semibold text-charcoal-ink">
                {current.serial}
              </p>
              <p className="mt-1 text-sm text-charcoal-ink/70">
                Valid until {formatPassportDate(current.expiresAt)}. Whoever you give it to can check it at{" "}
                <span className="font-mono text-xs">{current.verifyUrl}</span> without an account.
              </p>
              {current.attestingDoctorName ? (
                <p className="mt-2 text-sm text-brand-green">
                  Attested by Dr. {current.attestingDoctorName}
                  {current.attestingCredentialType && current.attestingCredentialNumber
                    ? ` (${current.attestingCredentialType} ${current.attestingCredentialNumber})`
                    : ""}
                  .
                </p>
              ) : (
                <p className="mt-2 text-sm text-charcoal-ink/60">
                  This is a signed export of your record. It proves we issued it and that nothing in
                  it has changed. It is not a doctor&rsquo;s statement. If an employer or an embassy needs
                  one, request an attestation below.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-charcoal-ink/70">
              You have not issued a passport yet. Downloading one issues it automatically, or you can
              issue it here first.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <a
              href="/api/patient/health-passport/pdf"
              className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Download PDF
            </a>
            {signingAvailable && (
              <Button
                variant="outline"
                onClick={() => issue.mutate(readyAttestation?.id ?? null)}
                disabled={issue.isPending}
              >
                {readyAttestation
                  ? "Issue attested passport"
                  : current
                    ? "Issue a replacement"
                    : "Issue my passport"}
              </Button>
            )}
          </div>

          {current && (
            <p className="text-xs text-charcoal-ink/50">
              Downloading again gives you the same document, not a new one. Issuing a replacement
              creates a new reference and marks the old one as replaced. Do that when your record
              has changed, or if you need to invalidate a copy you have already handed over.
            </p>
          )}

          {message && <p className="text-sm text-brand-green">{message}</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ask a doctor to attest it</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-charcoal-ink/70">
            Some organisations want more than an export: they want a named, registered doctor to
            confirm the record. A doctor on your care team can review it and add their name and
            registration number to your passport.
          </p>

          {readyAttestation && (
            <div className="rounded-md border border-brand-green/40 bg-brand-green/5 p-3">
              <p className="text-sm font-medium text-charcoal-ink">Your attestation is ready.</p>
              <p className="mt-1 text-sm text-charcoal-ink/70">
                Issue an attested passport above to put it on a document you can share.
              </p>
            </div>
          )}

          {pending ? (
            <div className="rounded-md border border-charcoal-ink/15 p-3">
              <p className="text-sm text-charcoal-ink">
                Waiting with your care team since {formatPassportDate(pending.requestedAt)}.
              </p>
              <p className="mt-1 text-sm text-charcoal-ink/60">For: {pending.purpose}</p>
              <button
                type="button"
                onClick={() => withdraw.mutate(pending.id)}
                className="mt-2 text-xs font-medium text-charcoal-ink/60 underline"
              >
                Withdraw this request
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="What is it for? e.g. UK visa medical, new employer, registering with a GP"
              />
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything the doctor should know (optional)"
              />
              <Button
                onClick={() => request.mutate()}
                disabled={request.isPending || purpose.trim().length < 3}
              >
                Request an attestation
              </Button>
            </div>
          )}

          {attestations
            .filter((a) => a.status === "declined")
            .slice(0, 1)
            .map((a) => (
              <p key={a.id} className="text-sm text-charcoal-ink/70">
                A previous request was declined on {formatPassportDate(a.reviewedAt)}
                {a.declineReason ? `: ${a.declineReason}` : "."}
              </p>
            ))}
        </CardContent>
      </Card>

      {passports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Passports you have issued</CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {passports.map((p) => (
                <PassportRow key={p.id} passport={p} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
