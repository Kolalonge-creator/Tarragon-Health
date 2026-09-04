"use client";

import { useMyComplaints } from "@/lib/queries/complaints";
import { COMPLAINT_CATEGORY_LABEL } from "@/lib/validation/complaints";
import { COMPLAINT_STATUS_BADGE } from "@/lib/worklist/ticket-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function ComplaintList({ patientId }: { patientId: string }) {
  const { data: complaints, isLoading } = useMyComplaints(patientId);

  if (isLoading) return null;
  if (!complaints || complaints.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-charcoal-ink">Your complaints</h3>
      {complaints.map((complaint) => {
        const statusBadge = COMPLAINT_STATUS_BADGE[complaint.status];
        return (
          <Card key={complaint.id}>
            <CardContent className="flex items-center justify-between gap-3 py-4">
              <div>
                <p className="font-medium text-charcoal-ink">{COMPLAINT_CATEGORY_LABEL[complaint.category as keyof typeof COMPLAINT_CATEGORY_LABEL]}</p>
                <p className="text-xs text-charcoal-ink/60">
                  Filed {new Date(complaint.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </p>
              </div>
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
