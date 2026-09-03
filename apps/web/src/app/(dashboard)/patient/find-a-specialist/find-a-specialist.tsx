"use client";

import { useState } from "react";
import { useMatchedSpecialistProviders } from "@/lib/queries/specialist-referrals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { koboToNaira, nairaToKobo, type SpecialistType } from "@tarragon/shared";
import type { PatientLocation } from "../facility-selector";

const SPECIALIST_TYPES: SpecialistType[] = [
  "cardiology",
  "endocrinology",
  "nephrology",
  "ophthalmology",
  "urologist",
  "oncologist",
  "ob_gyn",
  "dietetics",
  "podiatry",
  "psychiatry",
  "psychology",
  "other",
];

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
  const [state, setState] = useState(patientLocation?.state ?? "");
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Find a specialist</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="fas-type">Specialty</Label>
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
          <label className="flex items-end gap-2 pb-1.5 text-sm text-charcoal-ink/80">
            <input
              type="checkbox"
              checked={requireTelemedicine}
              onChange={(e) => setRequireTelemedicine(e.target.checked)}
            />
            Telemedicine only
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          {isLoading ? (
            <p className="text-sm text-charcoal-ink/60">Searching…</p>
          ) : (providers ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              No specialists match yet. Your care team is growing the network in your area. Message them and
              they can help arrange a referral.
            </p>
          ) : (
            (providers ?? []).map((provider) => (
              <div key={provider.id} className="space-y-1 rounded-md border border-charcoal-ink/10 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-charcoal-ink">{provider.name}</span>
                  <Badge variant="grey">{provider.specialist_type.replace(/_/g, " ")}</Badge>
                  {provider.subspecialty && <Badge variant="blue">{provider.subspecialty}</Badge>}
                  {provider.supports_telemedicine && <Badge variant="blue">Telemedicine</Badge>}
                </div>
                <p className="text-xs text-charcoal-ink/60">
                  {[provider.city, provider.state].filter(Boolean).join(", ") || "Location on file"}, ₦
                  {koboToNaira(provider.consultation_fee_kobo).toLocaleString()}
                  {provider.years_of_experience != null && ` · ${provider.years_of_experience} yrs experience`}
                </p>
                {provider.qualifications.length > 0 && (
                  <p className="text-xs text-charcoal-ink/60">{provider.qualifications.join(", ")}</p>
                )}
                {provider.clinical_interests.length > 0 && (
                  <p className="text-xs text-charcoal-ink/50">Focus: {provider.clinical_interests.join(", ")}</p>
                )}
                {provider.languages.length > 0 && (
                  <p className="text-xs text-charcoal-ink/50">Languages: {provider.languages.join(", ")}</p>
                )}
              </div>
            ))
          )}
          <p className="text-xs text-charcoal-ink/50">
            Interested in seeing one of these specialists? Message your care team and they&apos;ll arrange the
            referral.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
