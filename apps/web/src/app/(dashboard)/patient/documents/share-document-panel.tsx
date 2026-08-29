"use client";

import { useState, type FormEvent } from "react";
import {
  useCreatePatientDocumentShare,
  usePatientDocumentShares,
  useRevokePatientDocumentShare,
  type DocumentShareRecipientType,
  type PatientDocumentShare,
} from "@/lib/queries/patient-document-shares";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const RECIPIENT_TYPE_LABELS: Record<DocumentShareRecipientType, string> = {
  clinician: "Clinician",
  specialist: "Specialist",
  hospital: "Hospital",
  organisation: "Organisation",
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isActive(share: PatientDocumentShare): boolean {
  if (share.revokedAt) return false;
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) return false;
  return true;
}

function recipientLabel(share: PatientDocumentShare): string {
  if (share.recipientProfileId) {
    return share.recipientProfileName ?? "A Tarragon account";
  }
  const external = [share.recipientName, share.recipientOrganisation].filter(Boolean).join(", ");
  return external ? `External: ${external}` : "External recipient";
}

/**
 * Patient-authorised document sharing (§35.12) for one document. A patient
 * decides who may read this specific document — an existing Tarragon
 * account, or someone entirely outside the platform (name/organisation are
 * informational only for the latter; Tarragon has no way to enforce access
 * it never controls) — and can revoke that access at any time. Terms are
 * immutable once granted, per patient_document_shares_update_guard: a
 * changed mind means revoke-and-reshare, not editing an existing grant, so
 * this panel offers no edit action, only create and revoke.
 *
 * Fully self-contained by design — takes only documentId, so another
 * workstream's document library UI can drop it in with a single import.
 */
export function ShareDocumentPanel({ documentId }: { documentId: string }) {
  const { data: shares, isPending, isError } = usePatientDocumentShares(documentId);
  const createShare = useCreatePatientDocumentShare();
  const revokeShare = useRevokePatientDocumentShare();

  const [recipientType, setRecipientType] = useState<DocumentShareRecipientType>("clinician");
  const [recipientProfileId, setRecipientProfileId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientOrganisation, setRecipientOrganisation] = useState("");
  const [purpose, setPurpose] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  function resetForm() {
    setRecipientProfileId("");
    setRecipientName("");
    setRecipientOrganisation("");
    setPurpose("");
    setExpiresAt("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const trimmedPurpose = purpose.trim();
    if (!trimmedPurpose) {
      setFormError("Say why you're sharing this document.");
      return;
    }
    if (!recipientProfileId.trim() && !recipientName.trim() && !recipientOrganisation.trim()) {
      setFormError("Add who you're sharing this with — an account, a name, or an organisation.");
      return;
    }

    createShare.mutate(
      {
        documentId,
        recipientType,
        recipientProfileId: recipientProfileId.trim() || null,
        recipientName: recipientName.trim() || null,
        recipientOrganisation: recipientOrganisation.trim() || null,
        purpose: trimmedPurpose,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      },
      {
        onSuccess: () => resetForm(),
        onError: (cause) =>
          setFormError(cause instanceof Error ? cause.message : "That didn't save. Try again."),
      }
    );
  }

  function handleRevoke(shareId: string) {
    setRevokeError(null);
    setRevokingId(shareId);
    revokeShare.mutate(
      { shareId, documentId },
      {
        onSettled: () => setRevokingId(null),
        onError: (cause) =>
          setRevokeError(cause instanceof Error ? cause.message : "That didn't save. Try again."),
      }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Share this document</CardTitle>
        <CardDescription>
          Authorise someone to read this document — a clinician or specialist with a Tarragon
          account, or someone outside the platform. You can revoke access at any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-3 border-b border-charcoal-ink/10 pb-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="share-recipient-type">Recipient type</Label>
              <Select
                id="share-recipient-type"
                value={recipientType}
                onChange={(event) =>
                  setRecipientType(event.target.value as DocumentShareRecipientType)
                }
              >
                {Object.entries(RECIPIENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="share-recipient-profile-id">
                Existing Tarragon account id (optional)
              </Label>
              <Input
                id="share-recipient-profile-id"
                value={recipientProfileId}
                onChange={(event) => setRecipientProfileId(event.target.value)}
                placeholder="Leave blank for someone outside Tarragon"
              />
            </div>
          </div>

          <p className="text-xs text-charcoal-ink/60">
            Sharing with a doctor already on Tarragon? You&apos;ll need their account id for now — a
            proper search-by-name picker for your care team is a planned follow-up. Otherwise,
            describe them below instead.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="share-recipient-name">Recipient name (optional)</Label>
              <Input
                id="share-recipient-name"
                value={recipientName}
                onChange={(event) => setRecipientName(event.target.value)}
                placeholder="e.g. Dr. Adeyemi"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="share-recipient-organisation">
                Recipient organisation (optional)
              </Label>
              <Input
                id="share-recipient-organisation"
                value={recipientOrganisation}
                onChange={(event) => setRecipientOrganisation(event.target.value)}
                placeholder="e.g. Lagos University Teaching Hospital"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="share-purpose">Purpose</Label>
            <Textarea
              id="share-purpose"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="e.g. Second opinion, referral to specialist"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="share-expires-at">Expires (optional)</Label>
            <Input
              id="share-expires-at"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <Button type="submit" disabled={createShare.isPending}>
            {createShare.isPending ? "Sharing…" : "Share document"}
          </Button>
        </form>

        <div>
          {isPending && (
            <p className="text-sm text-charcoal-ink/60">Loading shares…</p>
          )}
          {isError && (
            <p className="text-sm text-red-600">
              Couldn&apos;t load who this document has been shared with. Try again.
            </p>
          )}
          {!isPending && !isError && (!shares || shares.length === 0) && (
            <p className="text-sm text-charcoal-ink/60">
              This document hasn&apos;t been shared with anyone yet.
            </p>
          )}
          {!isPending && !isError && shares && shares.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {shares.map((share) => {
                const active = isActive(share);
                return (
                  <li key={share.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-charcoal-ink">
                          {recipientLabel(share)}
                        </span>
                        <Badge variant="grey">{RECIPIENT_TYPE_LABELS[share.recipientType]}</Badge>
                        <Badge variant={active ? "green" : "grey"}>
                          {share.revokedAt
                            ? "Revoked"
                            : active
                              ? "Active"
                              : "Expired"}
                        </Badge>
                      </div>
                      <p className="text-sm text-charcoal-ink/70">{share.purpose}</p>
                      <p className="text-xs text-charcoal-ink/50">
                        Shared {shortDate(share.sharedAt)}
                        {share.expiresAt ? ` · Expires ${shortDate(share.expiresAt)}` : ""}
                        {share.revokedAt ? ` · Revoked ${shortDate(share.revokedAt)}` : ""}
                      </p>
                    </div>
                    {active && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={revokeShare.isPending && revokingId === share.id}
                        onClick={() => handleRevoke(share.id)}
                      >
                        {revokeShare.isPending && revokingId === share.id
                          ? "Revoking…"
                          : "Revoke"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {revokeError && <p className="mt-2 text-sm text-red-600">{revokeError}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
