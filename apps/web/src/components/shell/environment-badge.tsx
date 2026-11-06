/**
 * Doctor workspace spec 6: tell staff when they are NOT on the live platform, so a clinical action is never taken
 * on a preview by mistake (or a test taken for real). Production draws nothing.
 *
 * NEXT_PUBLIC_VERCEL_ENV is inlined at build time ("production", "preview" or "development"); when it is absent
 * (a local `next dev` without Vercel env), NODE_ENV decides.
 */
export function environmentBadgeLabel(vercelEnv: string | undefined, nodeEnv: string | undefined): string | null {
  if (vercelEnv === "production") return null;
  if (vercelEnv === "preview") return "Preview: test environment";
  if (vercelEnv === "development" || nodeEnv === "development") return "Local development";
  return null;
}

export function EnvironmentBadge() {
  const label = environmentBadgeLabel(process.env.NEXT_PUBLIC_VERCEL_ENV, process.env.NODE_ENV);
  if (!label) return null;
  return (
    <span
      role="status"
      className="inline-block max-w-[9rem] truncate whitespace-nowrap rounded-md border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 sm:max-w-none"
    >
      {label}
    </span>
  );
}
