"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="min-h-11 rounded border px-3 text-sm" onClick={() => window.print()}>
      {label}
    </button>
  );
}
