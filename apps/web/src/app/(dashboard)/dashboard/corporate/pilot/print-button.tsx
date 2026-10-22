"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-charcoal-ink/20 px-3 py-1.5 text-sm font-medium hover:bg-charcoal-ink/5"
    >
      {label}
    </button>
  );
}
