"use client";

import { useState } from "react";
import {
  usePharmacistProfile,
  usePharmacistUpdateProfile,
  type PharmacistProfile,
} from "@/lib/queries/pharmacist";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormState = {
  name: string;
  regions: string;
  city: string;
  state: string;
  contactPhone: string;
  contactEmail: string;
  licenseNumber: string;
  licenseExpiresAt: string;
  delivery: boolean;
};

function toFormState(profile: PharmacistProfile): FormState {
  return {
    name: profile.name,
    regions: profile.regions.join(", "),
    city: profile.city ?? "",
    state: profile.state ?? "",
    contactPhone: profile.contact_phone ?? "",
    contactEmail: profile.contact_email ?? "",
    licenseNumber: profile.license_number ?? "",
    licenseExpiresAt: profile.license_expires_at ? profile.license_expires_at.slice(0, 10) : "",
    delivery: profile.delivery,
  };
}

export function PharmacistProfileForm() {
  const { data: profile, isLoading } = usePharmacistProfile();

  if (isLoading) {
    return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  }
  if (!profile) {
    return <p className="text-sm text-charcoal-ink/60">No pharmacy profile on file yet.</p>;
  }

  return <ProfileFormFields profile={profile} />;
}

/** Mounted only once `profile` has loaded, so its form state can initialize
 * straight from the prop without an effect (React's "you might not need an
 * effect" pattern) — a lazy setState-in-effect would cascade an extra render
 * on every load. */
function ProfileFormFields({ profile }: { profile: PharmacistProfile }) {
  const update = usePharmacistUpdateProfile();
  const [form, setForm] = useState<FormState>(() => toFormState(profile));

  function field<K extends keyof FormState>(key: K) {
    return (value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSave() {
    update.mutate({
      name: form.name.trim(),
      regions: form.regions
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean),
      city: form.city.trim(),
      state: form.state.trim(),
      contactPhone: form.contactPhone.trim(),
      contactEmail: form.contactEmail.trim(),
      delivery: form.delivery,
      licenseNumber: form.licenseNumber.trim(),
      licenseExpiresAt: form.licenseExpiresAt || null,
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-[13px] text-charcoal-ink/60">
        Kept up to date so patients and coordinators can route orders and reach you.
      </p>

      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p_name">Pharmacy name</Label>
              <Input id="p_name" value={form.name} onChange={(e) => field("name")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p_regions">Regions (comma-separated)</Label>
              <Input id="p_regions" value={form.regions} onChange={(e) => field("regions")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p_city">City</Label>
              <Input id="p_city" value={form.city} onChange={(e) => field("city")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p_state">State</Label>
              <Input id="p_state" value={form.state} onChange={(e) => field("state")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p_phone">Contact phone</Label>
              <Input
                id="p_phone"
                value={form.contactPhone}
                onChange={(e) => field("contactPhone")(e.target.value)}
                placeholder="+234…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p_email">Contact email</Label>
              <Input
                id="p_email"
                type="email"
                value={form.contactEmail}
                onChange={(e) => field("contactEmail")(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3.5 border-t border-charcoal-ink/10 pt-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p_license_number">License number</Label>
              <Input
                id="p_license_number"
                value={form.licenseNumber}
                onChange={(e) => field("licenseNumber")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p_license_expires">License expires</Label>
              <Input
                id="p_license_expires"
                type="date"
                value={form.licenseExpiresAt}
                onChange={(e) => field("licenseExpiresAt")(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-charcoal-ink/75">
            <input
              type="checkbox"
              checked={form.delivery}
              onChange={(e) => field("delivery")(e.target.checked)}
            />
            Offers delivery
          </label>

          <div className="flex items-center gap-2.5">
            <Button onClick={handleSave} disabled={update.isPending || !form.name.trim()}>
              {update.isPending ? "Saving…" : "Save profile"}
            </Button>
            {update.isSuccess && !update.isPending && (
              <span className="text-xs font-medium text-brand-green">Saved.</span>
            )}
            {update.isError && <span className="text-xs text-red-600">Could not save. Try again.</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
