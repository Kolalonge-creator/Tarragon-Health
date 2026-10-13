/**
 * A member's picture is a preset word (for example "leaf") chosen by the database, never an upload. It is drawn as a plain initial in a
 * circle and hidden from assistive technology: the made-up name next to it is what identifies the member.
 */
export function AvatarBadge({ code }: { code: string | null }) {
  const initial = (code ?? "").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-soft-sage text-sm font-semibold text-brand-green dark:bg-brand-green/20 dark:text-brand-green-bright"
    >
      {initial}
    </span>
  );
}
