"use client";

import { useActionState, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLatestIdentityVerification } from "@/lib/queries/identity";
import { submitIdentityVerification } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  passport: "International passport",
  drivers_license: "Driver's licence",
  voters_card: "Voter's card",
  national_id_card: "National ID card",
};

/**
 * Optional identity verification (KYC). Non-blocking — the patient can always
 * skip it. When no provider is configured the request is recorded as pending
 * and reviewed later, so the control never clicks through to nothing (same
 * graceful-degradation posture as the wearable connect scaffolding).
 */
export function IdentityVerificationCard({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const { data: latest } = useLatestIdentityVerification(patientId);
  const [state, formAction, pending] = useActionState(submitIdentityVerification, undefined);
  const [method, setMethod] = useState<"nin" | "bvn" | "document">("nin");

  const alreadyVerified = latest?.status === "verified";
  const alreadyPending = latest?.status === "pending" || state?.status === "pending";

  return (
    <div className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
          Verify your identity{" "}
          <span className="text-sm font-normal text-charcoal-ink/50">(optional)</span>
        </h2>
        <p className="mt-1 text-sm text-charcoal-ink/60">
          Adding your NIN, BVN, or a document helps us keep your record secure. You can skip this
          and do it later.
        </p>
      </div>

      {alreadyVerified ? (
        <p className="rounded-lg bg-brand-green/10 p-3 text-sm text-brand-green">
          Your identity is verified.
        </p>
      ) : (
        <form action={formAction} className="space-y-3">
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="method">Type</Label>
              <Select
                id="method"
                name="method"
                value={method}
                onChange={(e) => setMethod(e.target.value as "nin" | "bvn" | "document")}
                required
              >
                <option value="nin">NIN</option>
                <option value="bvn">BVN</option>
                <option value="document">A document</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idNumber">{method === "document" ? "Reference number" : "11-digit number"}</Label>
              <Input
                id="idNumber"
                name="idNumber"
                inputMode={method === "document" ? "text" : "numeric"}
                autoComplete="off"
                placeholder={method === "document" ? "e.g. A01234567" : "XXXXXXXXXXX"}
                required
              />
            </div>
          </div>

          {method === "document" && (
            <div className="space-y-1.5">
              <Label htmlFor="documentType">Document type</Label>
              <Select id="documentType" name="documentType" defaultValue="" required>
                <option value="" disabled>
                  Choose a document
                </option>
                {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-charcoal-ink/50">
                Reviewed by our team — this can take a little longer than NIN/BVN.
              </p>
            </div>
          )}

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.status === "verified" && (
            <p className="text-sm text-brand-green">Your identity is verified.</p>
          )}
          {state?.status === "failed" && (
            <p className="text-sm text-red-600">
              We couldn&apos;t verify that number. Check it and try again, or skip for now.
            </p>
          )}
          {(state?.status === "unavailable" || state?.status === "pending" || alreadyPending) &&
            !state?.error && (
              <p className="text-sm text-charcoal-ink/60">
                Thanks — we&apos;ve recorded this and will confirm it shortly.
              </p>
            )}

          <Button
            type="submit"
            variant="outline"
            disabled={pending}
            onClick={() => {
              // refresh the latest-status query shortly after submit
              setTimeout(
                () =>
                  queryClient.invalidateQueries({ queryKey: ["identity-verification", patientId] }),
                500,
              );
            }}
          >
            {pending ? "Submitting…" : "Verify"}
          </Button>
        </form>
      )}
    </div>
  );
}
