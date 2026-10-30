"use client";

import { useState } from "react";
import { useMatchedSpecialistProviders } from "@/lib/queries/specialist-referrals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { koboToNaira, nairaToKobo, SPECIALIST_TYPES, type SpecialistType } from "@tarragon/shared";
import { canonicalizeNigerianState } from "@/lib/nigeria-states";
import type { PatientLocation } from "../facility-selector";

/**
 * Patient-initiated "find a specialist" browsing (66.6/66.10 — a searchable
 * specialist network, independent of an active referral). Reuses the exact
 * same useMatchedSpecialistProviders hook + filters the clinician worklist's
 * ChooseReferralSpecialist/AssignProviderForm already use — filtering an
 * existing catalogue, not ranking it, per
 * docs/CLINICAL_NETWORK_SPEC.md §3/§4 Phase 1 item 4.
 *
 * Deliberately read-only / informational: there's no "choose this specialist"
 * action here, because assigning a specialist_provider only makes sense in
 * the context of an actual specialist_referrals row a clinician has already
 * opened (set_referral_specialist_provider requires one). Letting a patient
 * browse the network without an open referral, and pointing them to their
 * care team to act on what they find, keeps this additive rather than
 * inventing a new patient-initiated-referral-creation flow that wasn't
 * asked for.
 */
export function FindASpecialist({ patientLocation }: { patientLocation?: PatientLocation | null }) {
  const [specialistType, setSpecialistType] = useState<SpecialistType>("cardiology");
  // Canonicalized: useMatchedSpecialistProviders compares this against
  // specialist_providers.state with a plain `=`, so a stale non-canonical profile value
  // (a casing/whitespace/"...State"-suffix variant) would otherwise silently lose the
  // same-state sort boost every real match should get. Falls back to the raw value when
  // it matches no canonical state.
  const [state, setState] = useState(canonicalizeNigerianState(patientLocation?.state));
  const [city, setCity] = useState(patientLocation?.city ?? "");
  const [requireTelemedicine, setRequireTelemedicine] = useState(false);
  const [maxFeeNaira, setMaxFeeNaira] = useState("");
  const [language, setLanguage] = useState("");

  const { data: providers, isLoading } = useMatchedSpecialistProviders({
    specialistType,
    state: state || undefined,
    city: city || undefined,
    requireTelemedicine,
    maxFeeKobo: maxFeeNaira ? nairaToKobo(Number(maxFeeNaira)) : undefined,
    language: language || undefined,
  });

  // How many of the optional filters are narrowing the results right now (the speciality is always on).
  const activeFilters = [state, city, language, maxFeeNaira].filter((v) => v !== "").length + (requireTelemedicine ? 1 : 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Find a specialist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fas-type">Speciality</Label>
            <Select
              id="fas-type"
              value={specialistType}
              onChange={(e) => setSpecialistType(e.target.value as SpecialistType)}
            >
              {SPECIALIST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </div>
          {/* The other filters are optional narrowing, so they are folded; the heading says how many are on. The results below
              are shown straight away for the chosen speciality (and the patient's own state and city when known). */}
          <Disclosure
            title="More filters"
            hint={activeFilters > 0 ? `${activeFilters} on` : "Location, fee, language, telemedicine"}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="fas-state">State</Label>
                <Input id="fas-state" value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Lagos" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fas-city">City</Label>
                <Input id="fas-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Ikeja" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fas-fee">Max consultation fee (₦, optional)</Label>
                <Input
                  id="fas-fee"
                  type="number"
                  min="0"
                  value={maxFeeNaira}
                  onChange={(e) => setMaxFeeNaira(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fas-language">Language (optional)</Label>
                <Input
                  id="fas-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="e.g. Yoruba"
                />
              </div>
              <label className="flex items-end gap-2 pb-1.5 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                <input
                  type="checkbox"
                  checked={requireTelemedicine}
                  onChange={(e) => setRequireTelemedicine(e.target.checked)}
                />
                Telemedicine only
              </label>
            </div>
          </Disclosure>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          {!isLoading && (providers ?? []).length > 0 && (
            <p role="status" className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              {(providers ?? []).length} {(providers ?? []).length === 1 ? "specialist" : "specialists"} in {specialistType.replace(/_/g, " ")}
            </p>
          )}
          {isLoading ? (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Searching…</p>
          ) : (providers ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              No specialists match yet. Your care team is growing the network in your area. Message them and
              they can help arrange a referral.
            </p>
          ) : (
            (providers ?? []).map((provider) => (
              <div key={provider.id} className="space-y-1 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-charcoal-ink dark:text-night-ink">{provider.name}</span>
                  <Badge variant="grey">{provider.specialist_type?.replace(/_/g, " ") ?? "Specialist"}</Badge>
                  {provider.subspecialty && <Badge variant="blue">{provider.subspecialty}</Badge>}
                  {provider.supports_telemedicine && <Badge variant="blue">Telemedicine</Badge>}
                </div>
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  {[provider.city, provider.state].filter(Boolean).join(", ") || "Location on file"}
                  {provider.consultation_fee_kobo != null
                    ? `, ₦${koboToNaira(provider.consultation_fee_kobo).toLocaleString()}`
                    : ""}
                  {provider.years_of_experience != null && ` · ${provider.years_of_experience} yrs experience`}
                </p>
                {!!provider.qualifications?.length && (
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{provider.qualifications.join(", ")}</p>
                )}
                {!!provider.clinical_interests?.length && (
                  <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">Focus: {provider.clinical_interests.join(", ")}</p>
                )}
                {!!provider.languages?.length && (
                  <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">Languages: {provider.languages.join(", ")}</p>
                )}
              </div>
            ))
          )}
          <div className="space-y-2 border-t border-charcoal-ink/10 pt-3 dark:border-night-ink/15">
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Interested in seeing one of these specialists? Message your care team and they&apos;ll arrange the
              referral.
            </p>
            <Button asChild size="sm">
              <Link href="/patient/messages">Message your care team</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
