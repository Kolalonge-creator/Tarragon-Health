import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { APPLICATION_STATE_LABEL, APPLICATION_STATE_TONE } from "@/lib/credentialing/labels";

/** The outcome of the last action, passed back through ?ok= or ?error=. A failure is always shown, never hidden. */
export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  const isError = Boolean(error);
  return (
    <div
      role={isError ? "alert" : "status"}
      className={
        isError
          ? "rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200"
          : "rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-500/40 dark:bg-green-500/15 dark:text-green-200"
      }
    >
      {error ?? ok}
    </div>
  );
}

export function StateBadge({ state }: { state: string }) {
  return <Badge variant={APPLICATION_STATE_TONE[state] ?? "grey"}>{APPLICATION_STATE_LABEL[state] ?? state}</Badge>;
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4 dark:border-night-ink/15 dark:bg-night-card">
      <div>
        <h2 className="text-base font-semibold text-charcoal-ink dark:text-night-ink">{title}</h2>
        {hint ? <p className="mt-0.5 text-sm text-charcoal-ink/60 dark:text-night-ink/60">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export const fieldClass =
  "h-10 w-full rounded-md border border-charcoal-ink/20 bg-white px-3 text-sm text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:border-night-ink/25 dark:bg-night-card dark:text-night-ink";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-charcoal-ink dark:text-night-ink">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-charcoal-ink/55 dark:text-night-ink/55">{hint}</span> : null}
    </label>
  );
}

export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

export function SubmitButton({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "danger" | "outline" }) {
  const base = "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  const tones = {
    default: "bg-brand-green text-white hover:bg-brand-green/90",
    danger: "bg-red-700 text-white hover:bg-red-700/90",
    outline: "border border-charcoal-ink/25 text-charcoal-ink hover:bg-charcoal-ink/5 dark:border-night-ink/25 dark:text-night-ink dark:hover:bg-night-ink/10",
  } as const;
  return (
    <button type="submit" className={`${base} ${tones[tone]}`}>
      {children}
    </button>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{children}</p>;
}
