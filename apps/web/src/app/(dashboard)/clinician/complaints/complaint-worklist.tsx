"use client";

import Link from "next/link";
import { useComplaintQueue } from "@/lib/queries/complaints";
import { COMPLAINT_CATEGORY_LABEL, type ComplaintCategoryInput } from "@/lib/validation/complaints";
import { COMPLAINT_STATUS_BADGE } from "@/lib/worklist/ticket-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ComplaintWorklist() {
  const { data: complaints, isLoading, isError } = useComplaintQueue();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Complaint worklist</CardTitle>
        <CardDescription>Oldest first — nothing here should sit without an owner.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the queue.</p>}
        {complaints && complaints.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">Nothing open right now.</p>
        )}
        {(complaints ?? []).map((complaint) => {
          const statusBadge = COMPLAINT_STATUS_BADGE[complaint.status];
          return (
            <Link key={complaint.id} href={`/clinician/complaints/${complaint.id}`}>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-charcoal-ink/10 px-4 py-3 transition hover:border-brand-green/40">
                <div>
                  <p className="font-medium text-charcoal-ink">
                    {COMPLAINT_CATEGORY_LABEL[complaint.category as ComplaintCategoryInput] ?? complaint.category}
                  </p>
                  <p className="text-xs text-charcoal-ink/60">{complaint.patient?.full_name ?? "Patient"}</p>
                </div>
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
