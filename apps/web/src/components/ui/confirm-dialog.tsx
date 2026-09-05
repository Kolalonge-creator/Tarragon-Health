"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A modal confirmation for an action that moves money or cannot be undone.
 *
 * Built on the native <dialog> element deliberately: showModal() gives the
 * focus trap, the inert background and Escape-to-close for free, which a
 * hand-rolled overlay has to reimplement and usually gets wrong. The body is
 * a slot rather than a plain message string because the point of these is the
 * recap — vendor, amount, what it is being paid from — not the question.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmDisabled = false,
  destructive = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Escape fires "cancel" natively; keep React's state as the source of truth.
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClose={() => {
        if (open) onCancel();
      }}
      className={cn(
        "w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-charcoal-ink/10 bg-white p-0 text-charcoal-ink shadow-lg",
        "backdrop:bg-charcoal-ink/40 dark:border-night-ink/15 dark:bg-night-card dark:text-night-ink"
      )}
    >
      <div className="space-y-4 p-6">
        <div className="space-y-1">
          <h2 id={titleId} className="font-heading text-lg font-semibold">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              {description}
            </p>
          )}
        </div>
        {children}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={confirmDisabled}
            onClick={onConfirm}
            className={destructive ? "bg-red-600 hover:bg-red-600/90" : undefined}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** The recap rows inside a ConfirmDialog: label on the left, value on the right. */
export function ConfirmDialogFacts({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="divide-y divide-charcoal-ink/10 rounded-lg border border-charcoal-ink/10 dark:divide-night-ink/15 dark:border-night-ink/15">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
          <dt className="text-charcoal-ink/60 dark:text-night-ink/60">{row.label}</dt>
          <dd className="text-right font-medium tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
