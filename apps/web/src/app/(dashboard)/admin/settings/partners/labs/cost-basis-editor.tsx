"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useUpdateLabProviderCostBasis,
  type LabProvider,
  type LabProviderCostBasis,
} from "@/lib/queries/partner-catalogues";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-GB");
}

/**
 * public.lab_providers.cost_basis records WHERE this provider's lab_tests
 * prices came from — 'published_list' (their public consumer price, the
 * truthful default: no invoice has been sighted) or 'contracted_invoice' (a
 * real negotiated rate someone has actually checked). See the migration
 * header (20260910054444_lab_provider_cost_basis.sql) for why this exists:
 * lab_tests.price_kobo was documented as "what SynLab charges Tarragon" and
 * turned out to match SynLab's own published retail price on eleven tests.
 *
 * Claiming 'contracted_invoice' without a document in hand is exactly what
 * caused that — the CHECK constraint refuses it without a verifier and a
 * non-empty note, so this form only ever lets an admin submit both together,
 * stamping the verifier from their own session rather than a free-text
 * field.
 */
export function CostBasisEditor({
  lab,
  isSuperAdmin,
}: {
  lab: LabProvider;
  isSuperAdmin: boolean;
}) {
  const update = useUpdateLabProviderCostBasis();
  const currentBasis = (lab.cost_basis as LabProviderCostBasis) ?? "published_list";
  const [costBasis, setCostBasis] = useState<LabProviderCostBasis>(currentBasis);
  const [note, setNote] = useState(lab.cost_basis_note ?? "");
  const [saved, setSaved] = useState(false);

  const noteRequired = costBasis === "contracted_invoice";

  return (
    <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-charcoal-ink/80">
          Where these recorded prices came from
        </p>
        <Badge variant={currentBasis === "contracted_invoice" ? "green" : "grey"}>
          {currentBasis === "contracted_invoice" ? "Contracted invoice" : "Published list"}
        </Badge>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        {currentBasis === "contracted_invoice"
          ? `Verified ${formatDate(lab.cost_basis_verified_at) ?? "—"}${
              lab.cost_basis_note ? ` · ${lab.cost_basis_note}` : ""
            }`
          : (lab.cost_basis_note ?? "No invoice has been sighted for this provider.")}
      </p>

      {!isSuperAdmin ? (
        <p className="text-xs text-charcoal-ink/50">
          Only an admin can change a lab&apos;s recorded cost basis.
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`cost-basis-${lab.id}`} className="text-xs">
                Cost basis
              </Label>
              <Select
                id={`cost-basis-${lab.id}`}
                className="h-8 text-xs"
                value={costBasis}
                onChange={(e) => setCostBasis(e.target.value as LabProviderCostBasis)}
              >
                <option value="published_list">Published list (public consumer price)</option>
                <option value="contracted_invoice">Contracted invoice (negotiated rate, sighted)</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`cost-basis-note-${lab.id}`} className="text-xs">
              {noteRequired ? "Which document did you check? (required)" : "Note (optional)"}
            </Label>
            <Textarea
              id={`cost-basis-note-${lab.id}`}
              rows={2}
              className="text-xs"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='e.g. "SynLab contracted rate sheet, emailed 2026-09-10 by their account manager"'
            />
          </div>
          {noteRequired && (
            <p className="text-xs text-charcoal-ink/50">
              Saving stamps you as the verifier, right now — only submit this with the document
              actually in hand.
            </p>
          )}
          {update.error && (
            <p className="text-xs text-red-600">{(update.error as Error).message}</p>
          )}
          {saved && !update.isPending && <p className="text-xs text-brand-green">Saved.</p>}
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending || (noteRequired && note.trim().length === 0)}
            onClick={() => {
              setSaved(false);
              update.mutate(
                { id: lab.id, costBasis, note },
                { onSuccess: () => setSaved(true) },
              );
            }}
          >
            {update.isPending ? "Saving…" : "Save cost basis"}
          </Button>
        </>
      )}
    </div>
  );
}
