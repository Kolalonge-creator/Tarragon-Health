import Link from "next/link";

/**
 * Patient-facing doctor name — the only thing patient-facing attribution
 * (messages, timeline, escalations, ask-a-doctor, second opinion, senior
 * case review) ever shows inline. Speciality, years of experience and bio
 * live only on the doctor's profile page (/patient/doctor/[staffId]) — see
 * docs/CLINICAL_TRUST_MODEL_SPEC.md's 2026-09-25/2026-09-26 correction.
 * Falls back to plain text when no clinical_staff id is available (e.g. a
 * generic "your care team" line has already handled that case upstream).
 */
export function DoctorNameLink({
  staffId,
  fullName,
  className,
}: {
  staffId: string | null | undefined;
  fullName: string;
  className?: string;
}) {
  if (!staffId) return <>Dr. {fullName}</>;
  return (
    <Link href={`/patient/doctor/${staffId}`} className={className ?? "underline-offset-2 hover:underline"}>
      Dr. {fullName}
    </Link>
  );
}
