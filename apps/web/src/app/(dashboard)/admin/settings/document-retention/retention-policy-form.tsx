"use client";

import { useActionState, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  upsertDocumentRetentionPolicy,
  deactivateDocumentRetentionPolicy,
  type DocumentRetentionPolicyActionState,
} from "./actions";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  type DocumentType,
} from "@/lib/validation/document-retention-policies";

export type DocumentRetentionPolicyRow = {
  id: string;
  document_type: DocumentType;
  retention_years: number;
  basis: string;
  active: boolean;
  updated_at: string;
};

/** Deactivate button for one policy row — never a real delete (archive-don't-delete). */
export function DeactivatePolicyButton({ policyId }: { policyId: string }) {
  const [state, action, pending] = useActionState<DocumentRetentionPolicyActionState, FormData>(
    () => deactivateDocumentRetentionPolicy(policyId),
    undefined
  );
  return (
    <form action={action} className="space-y-1">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Deactivating…" : "Deactivate"}
      </Button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

/**
 * Create/edit form for a single document type's retention policy. There is
 * no separate edit mode — the unique (organisation_id, document_type)
 * constraint means resubmitting for the same document type upserts the
 * existing row, so picking a type that already has a policy just prefills
 * its current values for editing.
 */
export function RetentionPolicyForm({ policies }: { policies: DocumentRetentionPolicyRow[] }) {
  const [state, formAction, pending] = useActionState<DocumentRetentionPolicyActionState, FormData>(
    upsertDocumentRetentionPolicy,
    undefined
  );
  const [documentType, setDocumentType] = useState<DocumentType>(DOCUMENT_TYPES[0]);

  const existing = useMemo(
    () => policies.find((p) => p.document_type === documentType) ?? null,
    [policies, documentType]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {existing ? "Update a retention policy" : "Add a retention policy"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Remounting on document-type change lets defaultValue re-prefill
            uncontrolled inputs without hand-syncing controlled state. */}
        <form action={formAction} className="space-y-3" key={documentType}>
          <div className="space-y-1">
            <Label htmlFor="document_type">Document type</Label>
            <Select
              id="document_type"
              name="document_type"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as DocumentType)}
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DOCUMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
            {existing && (
              <p className="text-xs text-charcoal-ink/50">
                Editing the existing {existing.active ? "active" : "inactive"} policy for this type.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="retention_years">Retention period (years)</Label>
            <Input
              id="retention_years"
              name="retention_years"
              type="number"
              min={1}
              step={1}
              defaultValue={existing?.retention_years}
              required
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="basis">Basis</Label>
            <Textarea
              id="basis"
              name="basis"
              rows={3}
              maxLength={500}
              defaultValue={existing?.basis}
              placeholder="e.g. NDPR minimum retention for clinical records; HMO contract clause 4.2"
              required
            />
            <p className="text-xs text-charcoal-ink/50">
              The regulation, contract clause, or internal policy behind this period — never a bare
              number with no justification.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="active"
              name="active"
              type="checkbox"
              defaultChecked={existing?.active ?? true}
              className="h-4 w-4 rounded border-charcoal-ink/30 text-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
            />
            <Label htmlFor="active" className="!mb-0">
              Active
            </Label>
          </div>

          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : existing ? "Update policy" : "Create policy"}
          </Button>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Saved.</p>}
        </form>
      </CardContent>
    </Card>
  );
}
