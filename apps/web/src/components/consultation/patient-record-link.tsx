import Link from "next/link";
import { z } from "zod";
import { TestAccountBadge } from "@/components/clinical/test-account-badge";

/**
 * The patient a doctor is about to call, as a link to their record (founder ask, 2026-11-03, after the first live
 * consultation: the list showed a first name and no way to the record). Rendered only from a real row (a patient id
 * and a name the database returned for this encounter's own clinician); a missing or malformed header renders "Patient"
 * with no link rather than a guessed name. Test accounts are badged next to the name (INV-13).
 */
export const patientHeaderSchema = z.object({
  patient_id: z.string().uuid(),
  patient_full_name: z.string().nullable(),
  patient_is_test: z.boolean().nullable().optional(),
});
export type PatientHeader = z.infer<typeof patientHeaderSchema>;

export function parsePatientHeader(data: unknown): PatientHeader | null {
  const parsed = patientHeaderSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function patientRecordHref(patientId: string): string {
  return `/clinician/patients/${patientId}`;
}

export function PatientRecordLink({ header, className }: { header: PatientHeader | null; className?: string }) {
  const name = header?.patient_full_name?.trim();
  if (!header || !name) return <span className={className}>Patient</span>;
  return (
    <span className={className}>
      <Link href={patientRecordHref(header.patient_id)} className="font-medium text-brand-green hover:underline">
        {name}
      </Link>
      {header.patient_is_test ? <TestAccountBadge className="ml-2 align-middle" /> : null}
    </span>
  );
}
