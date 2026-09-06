"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { decidePreauthorizationAction } from "./actions";

type Row = {
  id: string;
  service_category: string;
  estimated_amount_kobo: number;
  clinical_justification: string | null;
  status: string;
  authorization_number: string | null;
  denial_reason: string | null;
  requested_at: string;
  insurance_policies: { insurer_id: string; plan_name: string | null } | null;
};

const STATUS_BADGE: Record<string, "amber" | "green" | "red" | "grey"> = {
  pending: "amber",
  approved: "green",
  denied: "red",
  expired: "grey",
};

function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString()}`;
}

export function PreauthorizationsManager({ rows }: { rows: Row[] }) {
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function decide(fd: FormData) {
    startTransition(async () => {
      const result = await decidePreauthorizationAction(undefined, fd);
      setFeedback(result ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {feedback?.error && <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{feedback.error}</p>}
      {feedback?.message && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{feedback.message}</p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-charcoal-ink/60">No pre-authorisation requests yet.</p>
      ) : (
        rows.map((r) => (
          <Card key={r.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {r.service_category} · {naira(r.estimated_amount_kobo)}
                  {r.insurance_policies?.plan_name ? ` · ${r.insurance_policies.plan_name}` : ""}
                </CardTitle>
                <Badge variant={STATUS_BADGE[r.status] ?? "grey"}>{r.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {r.clinical_justification && (
                <p className="text-sm text-charcoal-ink/70">{r.clinical_justification}</p>
              )}
              {r.status === "pending" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      decide(new FormData(e.currentTarget));
                    }}
                  >
                    <input type="hidden" name="preauthorizationId" value={r.id} />
                    <input type="hidden" name="decision" value="approved" />
                    <Input name="authorizationNumber" placeholder="Auth #" required className="h-9" />
                    <Button type="submit" size="sm" disabled={pending}>
                      Approve
                    </Button>
                  </form>
                  <form
                    className="flex items-center gap-2 sm:col-span-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      decide(new FormData(e.currentTarget));
                    }}
                  >
                    <input type="hidden" name="preauthorizationId" value={r.id} />
                    <input type="hidden" name="decision" value="denied" />
                    <Input name="denialReason" placeholder="Reason for denial" required className="h-9" />
                    <Button type="submit" size="sm" variant="outline" disabled={pending}>
                      Deny
                    </Button>
                  </form>
                </div>
              ) : (
                <p className="text-sm text-charcoal-ink/60">
                  {r.status === "approved" && r.authorization_number
                    ? `Authorisation #${r.authorization_number}`
                    : r.denial_reason ?? ""}
                </p>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
