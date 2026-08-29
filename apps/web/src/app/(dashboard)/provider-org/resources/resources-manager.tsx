"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { createResourceAction, deactivateResourceAction } from "./actions";

type Resource = { id: string; resource_type: string; name: string; description: string | null };

export function ResourcesManager({ organisationId, resources }: { organisationId: string; resources: Resource[] }) {
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

  return (
    <div className="space-y-6">
      {feedback?.error && <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{feedback.error}</p>}
      {feedback?.message && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{feedback.message}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add a resource</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-4 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("organisationId", organisationId);
              run((f) => createResourceAction(undefined, f), fd);
              e.currentTarget.reset();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="resourceType">Type</Label>
              <Select id="resourceType" name="resourceType" required defaultValue="room">
                <option value="room">Room</option>
                <option value="equipment">Equipment</option>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required maxLength={200} placeholder="Consultation Room 3 / MRI machine" />
            </div>
            <Button type="submit" disabled={pending}>
              Add resource
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resources</CardTitle>
        </CardHeader>
        <CardContent>
          {resources.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No resources yet.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {resources.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium text-charcoal-ink">
                      {r.name} <Badge variant="grey">{r.resource_type}</Badge>
                    </p>
                    {r.description && <p className="text-sm text-charcoal-ink/60">{r.description}</p>}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      run((f) => deactivateResourceAction(undefined, f), new FormData(e.currentTarget));
                    }}
                  >
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" size="sm" variant="outline" disabled={pending}>
                      Remove
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
