"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invitePartnerStaffAction } from "@/lib/partner-admin/invite-staff-action";

/**
 * Rendered only for a profile with is_partner_admin = true (the page decides
 * that server-side before mounting this). Creates another login of the same
 * role, linked to the same provider — see invitePartnerStaffAction for why
 * that's safe to do without a Tarragon admin in the loop.
 */
export function PartnerStaffInviteForm() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite staff</CardTitle>
        <CardDescription>
          Create another login for your own team. It gets the same access you have, scoped to this
          provider.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setMessage(null);
            const formData = new FormData();
            formData.set("email", email);
            formData.set("fullName", fullName);
            formData.set("phone", phone);
            formData.set("password", password);
            startTransition(async () => {
              const result = await invitePartnerStaffAction(undefined, formData);
              if (result?.error) {
                setError(result.error);
              } else {
                setMessage(result?.message ?? "Login created.");
                setEmail("");
                setFullName("");
                setPhone("");
                setPassword("");
              }
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-name">Full name</Label>
            <Input
              id="invite-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-phone">Phone (E.164, optional)</Label>
            <Input
              id="invite-phone"
              placeholder="+234…"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-password">Temporary password</Label>
            <Input
              id="invite-password"
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          {message && <p className="text-sm text-brand-green sm:col-span-2">{message}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create login"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
