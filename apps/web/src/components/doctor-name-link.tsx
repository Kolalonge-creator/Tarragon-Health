import Link from "next/link";

/**
 * The doctor name shown in per-case attribution (messages, timeline,
 * escalations, ask-a-doctor, second opinion, senior case review) — never
 * speciality, years of experience or credential number inline. Those live
 * only on the doctor's profile page (/doctor/[staffId]) — see
 * docs/CLINICAL_TRUST_MODEL_SPEC.md's 2026-09-25/2026-09-26 correction.
 *
 * Links to /doctor/[staffId], NOT /patient/doctor/[staffId]: the components
 * that render this (ReviewedByDoctor, PatientTimeline, ReviewedResultLine,
 * CareMessageThread) are shared between /patient/* and /clinician/* pages,
 * and proxy.ts's role-home gate would redirect a clinician away from any
 * /patient/* path. A bare /doctor/[staffId] path matches no role-home
 * prefix, so it's reachable from either surface.
 *
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
    <Link href={`/doctor/${staffId}`} className={className ?? "underline-offset-2 hover:underline"}>
      Dr. {fullName}
    </Link>
  );
}
