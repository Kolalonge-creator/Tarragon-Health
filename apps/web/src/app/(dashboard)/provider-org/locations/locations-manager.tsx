"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { createLocationAction, deactivateLocationAction } from "./actions";

type Location = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  address: string | null;
  is_headquarters: boolean;
};

export function LocationsManager({ organisationId, locations }: { organisationId: string; locations: Location[] }) {
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
          <CardTitle>Add a location</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-4 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("organisationId", organisationId);
              run((f) => createLocationAction(undefined, f), fd);
              e.currentTarget.reset();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required maxLength={200} placeholder="Main hospital" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" maxLength={100} />
            </div>
            <Button type="submit" disabled={pending}>
              Add location
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Locations</CardTitle>
        </CardHeader>
        <CardContent>
          {locations.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No locations yet.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {locations.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium text-charcoal-ink">
                      {l.name} {l.is_headquarters && <Badge variant="blue">HQ</Badge>}
                    </p>
                    <p className="text-sm text-charcoal-ink/60">
                      {[l.address, l.city, l.state].filter(Boolean).join(", ") || "—"}
                    </p>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      run((f) => deactivateLocationAction(undefined, f), new FormData(e.currentTarget));
                    }}
                  >
                    <input type="hidden" name="id" value={l.id} />
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
