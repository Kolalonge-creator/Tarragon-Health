"use client";

import { useState } from "react";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { useManagedDependents } from "@/lib/queries/family-plan-members";
import type { PatientLocation } from "./facility-selector";
import { VaccinationRegistry } from "./vaccination-registry";
import { VaccinationBooking } from "./vaccination-booking";
import { LogVaccinationForm } from "./log-vaccination-form";
import { AddChildForm } from "./family/add-child-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Subject {
  id: string;
  label: string;
  ageYears: number | null;
  dateOfBirth: string | null;
  sex: "male" | "female" | null;
}

/**
 * Wraps the vaccination registry/booking/log-form with a "whose
 * vaccinations?" subject selector — the child-immunization-card bridge.
 * Every child a parent has provisioned (see family/add-child-form.tsx)
 * carries a real profiles row + a profile_access 'manage' grant, so the
 * existing patientId-parameterised components below work completely
 * unchanged once pointed at the child's id; this component only supplies
 * that id.
 */
export function VaccinationForFamily({
  self,
  patientLocation,
}: {
  self: Subject;
  patientLocation?: PatientLocation | null;
}) {
  const dependents = useManagedDependents();
  const [subjectId, setSubjectId] = useState(self.id);

  const subjects: Subject[] = [
    self,
    ...(dependents.data ?? []).map((d) => ({
      id: d.id,
      label: d.full_name ?? "Child",
      ageYears: ageFromDateOfBirth(d.date_of_birth),
      dateOfBirth: d.date_of_birth,
      sex: d.sex,
    })),
  ];
  const selected = subjects.find((s) => s.id === subjectId) ?? self;

  return (
    <div className="space-y-4">
      {subjects.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Whose vaccinations?</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {subjects.map((subject) => (
              <button
                key={subject.id}
                type="button"
                onClick={() => setSubjectId(subject.id)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  subject.id === selected.id
                    ? "border-brand-green bg-brand-green/10 font-medium text-deep-forest"
                    : "border-charcoal-ink/15 text-charcoal-ink/70 hover:border-brand-green/40"
                }`}
              >
                {subject.label}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <VaccinationRegistry
        patientId={selected.id}
        ageYears={selected.ageYears}
        dateOfBirth={selected.dateOfBirth}
        sex={selected.sex}
      />
      <VaccinationBooking patientId={selected.id} patientLocation={patientLocation} />
      <LogVaccinationForm
        patientId={selected.id}
        ageYears={selected.ageYears}
        dateOfBirth={selected.dateOfBirth}
        sex={selected.sex}
      />
      <AddChildForm />
    </div>
  );
}
