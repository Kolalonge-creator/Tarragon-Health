"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createServiceAction, deactivateServiceAction } from "./actions";

type Service = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number | null;
  price_kobo: number | null;
};

export function ServicesManager({ organisationId, services }: { organisationId: string; services: Service[] }) {
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
          <CardTitle>Add a service</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-4 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("organisationId", organisationId);
              run((f) => createServiceAction(undefined, f), fd);
              e.currentTarget.reset();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required maxLength={200} placeholder="Cardiology consultation" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="durationMinutes">Duration (min)</Label>
              <Input id="durationMinutes" name="durationMinutes" type="number" min={1} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priceKobo">Price (kobo)</Label>
              <Input id="priceKobo" name="priceKobo" type="number" min={0} />
            </div>
            <Button type="submit" disabled={pending}>
              Add service
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No services yet.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {services.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium text-charcoal-ink">{s.name}</p>
                    <p className="text-sm text-charcoal-ink/60">
                      {s.duration_minutes ? `${s.duration_minutes} min` : "—"}
                      {s.price_kobo !== null ? ` · ₦${(s.price_kobo / 100).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      run((f) => deactivateServiceAction(undefined, f), new FormData(e.currentTarget));
                    }}
                  >
                    <input type="hidden" name="id" value={s.id} />
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
