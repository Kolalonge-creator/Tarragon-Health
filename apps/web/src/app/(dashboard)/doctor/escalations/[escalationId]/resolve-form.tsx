"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useResolveEscalation } from "@/lib/queries/escalations";
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
          <p className="text-sm text-red-600">Could not save. Try again.</p>
        )}
        <Button
          disabled={resolve.isPending || resolutionNote.trim().length === 0}
          onClick={() => {
            resolve.mutate(
              { escalationId, status, resolutionNote: resolutionNote.trim() },
              { onSuccess: () => router.push("/doctor") }
            );
          }}
        >
          Submit
        </Button>
      </CardContent>
    </Card>
  );
}
