import { Avatar } from "@/components/avatar";

/** Shared 40px clinical_staff avatar — a real photo, or initials on a sage circle (same fallback style as the account menu). */
export function ClinicalStaffAvatar({
  fullName,
  photoUrl,
}: {
  fullName: string;
  photoUrl: string | null;
}) {
  return <Avatar fullName={fullName} photoUrl={photoUrl} size="lg" alt={`Dr. ${fullName}`} />;
}
