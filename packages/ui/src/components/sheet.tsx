"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../utils";

/**
 * A bottom sheet on phones and a centred panel from `sm` up. Closes on
 * Escape, on the Close button and on a tap outside. Web twin of the mobile
 * Sheet. `layerClassName` lets a caller place it under a higher layer (the
 * emergency control sits below the EmergencyAlert dialog, which is z-50).
 */
export function Sheet({
  open,
  onClose,
  title,
  titleIcon,
  tone = "default",
  layerClassName = "z-50",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  titleIcon?: React.ReactNode;
  tone?: "default" | "danger";
  layerClassName?: string;
  children: React.ReactNode;
}) {
  const titleId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Return focus to whatever opened the sheet when it closes.
  React.useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("[data-sheet-close]")?.focus();
    return () => opener?.focus?.();
  }, [open]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={cn("fixed inset-0 flex items-end justify-center bg-charcoal-ink/60 sm:items-center sm:p-4 print:hidden", layerClassName)}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
          return;
        }
        // Keep Tab inside the sheet: it is modal, so the page behind must not take focus.
        if (e.key === "Tab" && panelRef.current) {
          const items = panelRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
          );
          if (items.length === 0) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div
        ref={panelRef}
        className={cn(
          "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-xl dark:bg-night-card dark:shadow-none sm:rounded-2xl",
          tone === "danger" && "border border-red-200 dark:border-red-500/30",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
          <h2
            id={titleId}
            className={cn(
              "flex items-center gap-2 text-sm font-semibold",
              tone === "danger" ? "text-red-700 dark:text-red-300" : "text-charcoal-ink dark:text-night-ink",
            )}
          >
            {titleIcon}
            {title}
          </h2>
          <button
            type="button"
            data-sheet-close
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-1.5 text-charcoal-ink/70 hover:bg-charcoal-ink/5 dark:text-night-ink/70"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="px-5 pb-5 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
