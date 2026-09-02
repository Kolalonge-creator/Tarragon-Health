"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PasswordInput } from "@/components/ui/password-input";
import { Badge } from "@/components/ui/badge";
import { invitePayerAdminAction, deactivatePayerSeatAction } from "./actions";

type Seat = {
  id: string;
  payer_role: string;
  job_title: string | null;
  is_active: boolean;
  full_name: string;
};

export function TeamManager({ insurerId, seats }: { insurerId: string; seats: Seat[] }) {
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
          <CardTitle>Add a team member</CardTitle>
          <CardDescription>
            27.14 — a seat only ever holds the powers its job needs. &ldquo;Owner&rdquo; can also manage other
            seats.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("insurerId", insurerId);
              run((f) => invitePayerAdminAction(undefined, f), fd);
              e.currentTarget.reset();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" name="fullName" required maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Temporary password</Label>
              <PasswordInput id="password" name="password" required minLength={8} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payerRole">Role</Label>
              <Select id="payerRole" name="payerRole" required defaultValue="analyst">
                <option value="owner">Owner</option>
                <option value="benefits_manager">Benefits manager</option>
                <option value="authorisation_officer">Authorisation officer</option>
                <option value="claims_officer">Claims officer</option>
                <option value="analyst">Analyst</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jobTitle">Job title (optional)</Label>
              <Input id="jobTitle" name="jobTitle" maxLength={200} />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={pending}>
                Add
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent>
          {seats.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No seats yet.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {seats.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium text-charcoal-ink">
                      {s.full_name} {s.job_title ? `· ${s.job_title}` : ""}
                    </p>
                    <p className="text-sm text-charcoal-ink/60">
                      {s.payer_role} <Badge variant={s.is_active ? "green" : "grey"}>{s.is_active ? "active" : "deactivated"}</Badge>
                    </p>
                  </div>
                  {s.is_active && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        run((f) => deactivatePayerSeatAction(undefined, f), new FormData(e.currentTarget));
                      }}
                    >
                      <input type="hidden" name="seatId" value={s.id} />
                      <Button type="submit" size="sm" variant="outline" disabled={pending}>
                        Deactivate
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
