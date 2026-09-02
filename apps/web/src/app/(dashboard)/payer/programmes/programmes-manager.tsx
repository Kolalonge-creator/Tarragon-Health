"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { createPayerDirectiveAction, applyPayerDirectiveAction } from "./actions";

type Directive = {
  id: string;
  programme_id: string;
  is_active: boolean;
  programme_name: string;
  condition: string;
};

type Programme = { id: string; name: string; condition: string };

export function ProgrammesManager({
  insurerId,
  directives,
  programmes,
}: {
  insurerId: string;
  directives: Directive[];
  programmes: Programme[];
}) {
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: (fd: FormData) => Promise<{ error?: string; message?: string } | undefined>, fd: FormData) {
    startTransition(async () => {
      const result = await action(fd);
      setFeedback(result ?? null);
      router.refresh();
    });
  }

  const directedProgrammeIds = new Set(directives.map((d) => d.programme_id));
  const available = programmes.filter((p) => !directedProgrammeIds.has(p.id));

  return (
    <div className="space-y-6">
      {feedback?.error && <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{feedback.error}</p>}
      {feedback?.message && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{feedback.message}</p>
      )}

      {available.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>New directive</CardTitle>
            <CardDescription>Enrol every current and future verified member with this condition.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                fd.set("insurerId", insurerId);
                run((f) => createPayerDirectiveAction(undefined, f), fd);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="programmeId">Programme</Label>
                <Select id="programmeId" name="programmeId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.condition})
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" disabled={pending}>
                Create directive
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Directives</CardTitle>
        </CardHeader>
        <CardContent>
          {directives.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No standing directives yet.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {directives.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium text-charcoal-ink">{d.programme_name}</p>
                    <p className="text-sm text-charcoal-ink/60">
                      {d.condition} <Badge variant={d.is_active ? "green" : "grey"}>{d.is_active ? "active" : "paused"}</Badge>
                    </p>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      run((f) => applyPayerDirectiveAction(undefined, f), new FormData(e.currentTarget));
                    }}
                  >
                    <input type="hidden" name="directiveId" value={d.id} />
                    <Button type="submit" variant="outline" disabled={pending || !d.is_active}>
                      Apply now
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
