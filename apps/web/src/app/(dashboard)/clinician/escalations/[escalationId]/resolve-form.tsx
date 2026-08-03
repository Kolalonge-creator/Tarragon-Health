"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useResolveEscalation, fetchDoctorEscalations } from "@/lib/queries/escalations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ResolveForm({ escalationId }: { escalationId: string }) {
  const router = useRouter();
  const resolve = useResolveEscalation();
  const [status, setStatus] = useState<"resolved" | "referred">("resolved");
  const [resolutionNote, setResolutionNote] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resolve escalation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="status">Outcome</Label>
          <Select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "resolved" | "referred")}
          >
            <option value="resolved">Resolved</option>
            <option value="referred">Referred</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="resolution-note">Resolution note</Label>
          <Input
            id="resolution-note"
            placeholder="Summary of the outcome"
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
          />
        </div>
        {resolve.isError && (
          <p className="text-sm text-red-600">
            {resolve.error?.message || "Could not save. Try again."}
          </p>
        )}
        <Button
          disabled={resolve.isPending || resolutionNote.trim().length === 0}
          onClick={() => {
            resolve.mutate(
              { escalationId, status, resolutionNote: resolutionNote.trim() },
              {
                onSuccess: async () => {
                  // Send the doctor straight to the next-highest-priority open
                  // case instead of bouncing them back to the top of the
                  // dashboard every time — a doctor working a long queue
                  // shouldn't lose their place after every single resolution.
                  // Best-effort: any failure here just falls back to
                  // /clinician, same as before this existed.
                  try {
                    const remaining = (await fetchDoctorEscalations()).filter(
                      (escalation) => escalation.id !== escalationId
                    );
                    if (remaining.length > 0) {
                      router.push(`/clinician/escalations/${remaining[0].id}`);
                      return;
                    }
                  } catch {
                    // fall through to /clinician below
                  }
                  router.push("/clinician");
                },
              }
            );
          }}
        >
          Submit
        </Button>
      </CardContent>
    </Card>
  );
}
