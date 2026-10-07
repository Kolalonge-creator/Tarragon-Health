"use client";

import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addElderProxyDependentAction } from "./add-elder-actions";
import { addElderProxyDependentSchema, ELDER_PROXY_REASONS } from "@/lib/validation/elder-proxy-dependent";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * "My father does not use smartphones" — sets up a record for an adult who
 * cannot self-onboard, without waiting on a care_access_requests accept they
 * have no way to give. See add-elder-actions.ts for the safety checks this
 * relies on (phone-lookup refusal, explicit consent attestation).
 */
export function AddElderProxyForm() {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState("");
  const [confirmedConsent, setConfirmedConsent] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const parsed = addElderProxyDependentSchema.safeParse({
      full_name: fullName,
      phone,
      relationship,
      date_of_birth: dateOfBirth,
      sex: sex || undefined,
      confirmed_consent: confirmedConsent || undefined,
      reason: reason || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid details");
      return;
    }

    setIsPending(true);
    try {
      const result = await addElderProxyDependentAction(parsed.data);
      if ("error" in result) {
        setError(result.error);
      } else {
        setSuccess(result.message);
        setFullName("");
        setPhone("");
        setRelationship("");
        setDateOfBirth("");
        setSex("");
        setConfirmedConsent(false);
        setReason("");
        await queryClient.invalidateQueries({ queryKey: ["adults-i-manage"] });
        await queryClient.invalidateQueries({ queryKey: ["sponsorable-profiles"] });
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up an account for someone who can&apos;t do this themselves</CardTitle>
        <CardDescription>
          For an adult who doesn&apos;t use a smartphone or won&apos;t be signing up on their own:
          you keep their record and handle their bookings, reminders and pharmacy orders. Only for
          someone who&apos;s agreed to this and who cannot confirm it themselves. If they can receive a
          text message, use &quot;Set up for my parent&quot; instead: they confirm it on their own phone and choose what you see.
          If they already have a Tarragon account, ask them to accept an eldercare request so they keep control of it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {success && <p className="text-sm text-brand-green dark:text-brand-green-bright">{success}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="elder_full_name">Their name</Label>
            <Input
              id="elder_full_name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="elder_phone">Their phone number</Label>
              <Input
                id="elder_phone"
                type="tel"
                placeholder="+2348012345678"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="elder_relationship">Their relationship to you</Label>
              <Input
                id="elder_relationship"
                placeholder="e.g. father"
                value={relationship}
                onChange={(event) => setRelationship(event.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="elder_date_of_birth">Date of birth</Label>
              <Input
                id="elder_date_of_birth"
                type="date"
                value={dateOfBirth}
                onChange={(event) => setDateOfBirth(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="elder_sex">Sex (optional)</Label>
              <Select id="elder_sex" value={sex} onChange={(event) => setSex(event.target.value)}>
                <option value="">Not specified</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="elder_reason">Why can&apos;t they confirm this on their own phone?</Label>
            <Select id="elder_reason" value={reason} onChange={(event) => setReason(event.target.value)} required>
              <option value="">Choose one</option>
              {ELDER_PROXY_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>

          <label className="flex items-start gap-2 text-sm text-charcoal-ink dark:text-night-ink">
            <input
              type="checkbox"
              id="elder_confirmed_consent"
              className="mt-0.5 h-4 w-4 rounded border-charcoal-ink/30 dark:border-night-ink/35"
              checked={confirmedConsent}
              onChange={(event) => setConfirmedConsent(event.target.checked)}
              required
            />
            <span className="text-charcoal-ink/80 dark:text-night-ink/80">
              I confirm they&apos;ve agreed to me setting this up and managing it for them.
            </span>
          </label>

          <Button type="submit" disabled={isPending}>
            {isPending ? "Setting up…" : "Set up their account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
