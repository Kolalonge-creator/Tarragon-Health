function initialsFor(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/** Shared 40px clinical_staff avatar — a real photo, or initials on a sage circle (same fallback style as the account menu). */
export function ClinicalStaffAvatar({
  fullName,
  photoUrl,
}: {
  fullName: string;
  photoUrl: string | null;
}) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- clinical_staff.photo_url is an arbitrary storage URL, not a configured next/image remote pattern
      <img
        src={photoUrl}
        alt={`Dr. ${fullName}`}
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-soft-sage font-heading text-xs font-semibold text-deep-forest"
    >
      {initialsFor(fullName) || "•"}
    </span>
  );
}
