"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "./state";
import { btnPrimary } from "./ui";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  /** Asked before the form is sent. */
  confirm?: string;
  /** Asked only when the named field differs from its starting value. */
  confirmIfChanged?: { name: string; initial: string; message: string };
  className?: string;
  /** Render the result below the button (default) or let the caller place it. */
  renderResult?: (state: ActionState) => ReactNode;
};

/** A form that runs a server action, disables itself while working, and announces the plain-English result politely. */
export function ActionForm({ action, children, submitLabel, pendingLabel = "Working...", submitClassName = btnPrimary, confirm, confirmIfChanged, className, renderResult }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      className={className ?? "space-y-3"}
      onSubmit={(e) => {
        let message: string | null = confirm ?? null;
        if (!message && confirmIfChanged) {
          const v = new FormData(e.currentTarget).get(confirmIfChanged.name);
          const now = typeof v === "string" ? v.trim() : "";
          if (now !== confirmIfChanged.initial.trim()) message = confirmIfChanged.message;
        }
        if (message && !window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
      <button type="submit" disabled={pending} className={submitClassName}>
        {pending ? pendingLabel : submitLabel}
      </button>
      <div aria-live="polite" aria-atomic="true">
        {state && (
          <p role={state.ok ? "status" : "alert"} className={`rounded-xl border p-3 text-sm ${state.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
            <span className="font-semibold">{state.ok ? "Done. " : "Not done. "}</span>
            {state.message}
          </p>
        )}
        {renderResult?.(state)}
      </div>
    </form>
  );
}
