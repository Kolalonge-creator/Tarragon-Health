"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type {
  FundingProgramme,
  FundingProgrammeStats,
  FundingProgrammeStatus,
} from "@/lib/ngo/funding-programmes";
import { createNgoProgrammeAction, setNgoProgrammeStatusAction } from "./actions";

type NgoOrganisation = { id: string; name: string };
type Product = { id: string; name: string; code: string; price_kobo: number };

const STATUS_BADGE: Record<FundingProgrammeStatus, "grey" | "green" | "amber" | "red"> = {
  draft: "grey",
  active: "green",
  expired: "amber",
  cancelled: "red",
};

/** The one valid next status for each current status, per the RPC's own state machine. */
const NEXT_STATUS: Record<FundingProgrammeStatus, FundingProgrammeStatus[]> = {
  draft: ["active"],
  active: ["expired", "cancelled"],
  expired: [],
  cancelled: [],
};

function kobo(n: number): string {
  return `₦${(n / 100).toLocaleString("en-NG")}`;
}

export function NgoProgrammesManager({
  ngoOrganisations,
  products,
  programmes,
  stats,
}: {
  ngoOrganisations: NgoOrganisation[];
  products: Product[];
  programmes: FundingProgramme[];
  stats: Record<string, FundingProgrammeStats>;
}) {
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [statusChange, setStatusChange] = useState<{
    programme: FundingProgramme;
    status: FundingProgrammeStatus;
  } | null>(null);
  const [note, setNote] = useState("");
  const router = useRouter();
  const createFormRef = useRef<HTMLFormElement>(null);

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const result = await createNgoProgrammeAction(undefined, formData);
      setFeedback(result ?? null);
      if (!result?.error) {
        createFormRef.current?.reset();
        router.refresh();
      }
    });
  }

  function confirmStatusChange() {
    const target = statusChange;
    setStatusChange(null);
    if (!target) return;
    const formData = new FormData();
    formData.set("programmeId", target.programme.id);
    formData.set("status", target.status);
    formData.set("note", note);
    startTransition(async () => {
      const result = await setNgoProgrammeStatusAction(undefined, formData);
      setFeedback(result ?? null);
      setNote("");
      if (!result?.error) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {feedback?.error && (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{feedback.error}</p>
      )}
      {feedback?.message && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{feedback.message}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create a programme</CardTitle>
          <CardDescription>
            Only for an organisation already typed &quot;ngo&quot; with a signed contract — this does
            not send anything to anyone. Ships as a draft; activate it separately once the roster is
            ready.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={createFormRef} action={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="organisationId">NGO / PHC organisation</Label>
              <Select id="organisationId" name="organisationId" required defaultValue="">
                <option value="" disabled>
                  Select an organisation
                </option>
                {ngoOrganisations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </Select>
              {ngoOrganisations.length === 0 && (
                <p className="text-xs text-charcoal-ink/60">
                  No organisation is typed &quot;ngo&quot; yet — create one from Members/Organisations
                  first.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="serviceProductId">Funded service</Label>
              <Select id="serviceProductId" name="serviceProductId" required defaultValue="">
                <option value="" disabled>
                  Select a service
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({kobo(p.price_kobo)})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Programme name</Label>
              <Input id="name" name="name" required maxLength={200} placeholder="e.g. Lagos HTN Screening 2026" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contractReference">Contract reference</Label>
              <Input id="contractReference" name="contractReference" required maxLength={200} placeholder="e.g. CR-2026-014" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fundedUnitCap">Funded places</Label>
              <Input id="fundedUnitCap" name="fundedUnitCap" type="number" min={1} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priceKobo">Contracted price override (kobo, optional)</Label>
              <Input id="priceKobo" name="priceKobo" type="number" min={0} placeholder="Leave blank to use the catalogue price" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="startsAt">Starts (optional)</Label>
              <Input id="startsAt" name="startsAt" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endsAt">Ends (optional)</Label>
              <Input id="endsAt" name="endsAt" type="date" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending || ngoOrganisations.length === 0}>
                Create draft programme
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink">
          Existing programmes
        </h2>
        {programmes.length === 0 ? (
          <Card variant="soft">
            <CardContent className="py-6 text-sm text-charcoal-ink/60">No programmes yet.</CardContent>
          </Card>
        ) : (
          programmes.map((p) => {
            const s = stats[p.id];
            return (
              <Card key={p.id}>
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <div>
                    <CardTitle>{p.name}</CardTitle>
                    <CardDescription>Contract {p.contract_reference}</CardDescription>
                  </div>
                  <Badge variant={STATUS_BADGE[p.status]}>{p.status}</Badge>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                  {s ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                      <div>
                        <dt className="text-xs uppercase text-charcoal-ink/50">Funded places</dt>
                        <dd>{s.fundedUnitCap}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase text-charcoal-ink/50">Invited</dt>
                        <dd>{s.invited}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase text-charcoal-ink/50">Claimed</dt>
                        <dd>{s.claimed}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase text-charcoal-ink/50">Remaining</dt>
                        <dd>{s.unitsRemaining}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-xs text-charcoal-ink/50">Stats unavailable right now.</p>
                  )}
                  {NEXT_STATUS[p.status].length > 0 && (
                    <div className="flex gap-2">
                      {NEXT_STATUS[p.status].map((next) => (
                        <Button
                          key={next}
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => setStatusChange({ programme: p, status: next })}
                        >
                          Mark {next}
                        </Button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <ConfirmDialog
        open={statusChange !== null}
        title={statusChange ? `Change status to "${statusChange.status}"?` : ""}
        description={
          statusChange?.status === "active"
            ? "The org's ngo_admin can invite their roster the moment this lands."
            : "This is terminal — the programme cannot be reactivated once expired or cancelled."
        }
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        destructive={statusChange?.status === "cancelled"}
        onConfirm={confirmStatusChange}
        onCancel={() => {
          setStatusChange(null);
          setNote("");
        }}
      >
        <div className="space-y-1.5 pt-2">
          <Label htmlFor="status-note">Note (optional)</Label>
          <Textarea
            id="status-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this status change, for the audit log"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
