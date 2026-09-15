export function initialsFor(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

const AVATAR_SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-10 w-10 text-xs",
  xl: "h-12 w-12 text-sm",
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZE_CLASSES;

/** Shared avatar — a real photo when `photoUrl` is set, otherwise initials on
 * a sage circle. Used for clinical_staff.photo_url, profiles.avatar_url, and
 * anywhere else a person's identity needs a fallback-safe visual. */
export function Avatar({
  fullName,
  photoUrl,
  size = "md",
  alt,
}: {
  fullName: string;
  photoUrl?: string | null;
  size?: AvatarSize;
  /** Defaults to `fullName` — pass e.g. `Dr. ${fullName}` to be specific. */
  alt?: string;
}) {
  const sizeClass = AVATAR_SIZE_CLASSES[size];

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary storage URL, not a configured next/image remote pattern
      <img
        src={photoUrl}
        alt={alt ?? fullName}
        className={`${sizeClass} shrink-0 rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full bg-soft-sage dark:bg-brand-green/20 font-heading font-semibold text-deep-forest dark:text-brand-green-bright`}
    >
      {initialsFor(fullName) || "•"}
    </span>
  );
}
