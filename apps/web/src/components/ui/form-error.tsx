import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one way a form failure is shown on this platform.
 *
 * Before this existed there were ~190 hand-rolled `<p className="text-sm
 * text-red-600">{state.error}</p>` lines across the patient and auth
 * surfaces and exactly two `role="alert"`s, so a screen-reader user who
 * submitted a form heard nothing at all: focus stayed on the submit button,
 * the failure text was inserted silently below it, and no field was ever
 * marked invalid. `role="alert"` makes the insertion an assertive live-region
 * announcement, and `fieldErrorProps` below is what points the offending
 * control at this element.
 *
 * Renders nothing when there is no message, so it is safe to leave mounted.
 * `tabIndex={-1}` is deliberate: it keeps the element focusable
 * programmatically (for a form that wants to move focus to the failure) while
 * keeping it out of the tab order for everyone else.
 *
 * No "use client" — this is presentational only, so it works in both server
 * and client components.
 */
export function FormError({
  id,
  message,
  className,
}: {
  /** Stable id, referenced by the failing field's `aria-describedby`. */
  id: string;
  /** Falsy renders nothing. */
  message?: string | null | false;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      tabIndex={-1}
      className={cn("text-sm text-red-600 dark:text-red-300", className)}
    >
      {message}
    </p>
  );
}

/**
 * Success counterpart. Not an `alert` — a success is polite, not assertive —
 * but it still has to be announced, which a plain `<p>` never is.
 */
export function FormSuccess({
  message,
  className,
}: {
  message?: string | null | false;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      role="status"
      className={cn("text-sm text-brand-green dark:text-brand-green-bright", className)}
    >
      {message}
    </p>
  );
}

/** Conventional id for a field's error element, derived from the field id. */
export function fieldErrorId(fieldId: string): string {
  return `${fieldId}-error`;
}

/**
 * Props to spread onto the input/select/textarea that failed.
 *
 * `invalid` is usually "the server said this field is the problem" — most
 * actions here return a single message plus the field name from the Zod
 * issue path, so only the real offender gets marked rather than every control
 * on the form.
 *
 * `describedBy` carries any hint text already sitting under the field: an
 * `aria-describedby` naming only the error would silence a format hint the
 * sighted user can still read, so both ids are listed, error first.
 */
export function fieldErrorProps(
  errorId: string,
  invalid: boolean,
  ...describedBy: Array<string | false | null | undefined>
): { "aria-invalid"?: true; "aria-describedby"?: string } {
  const ids = [invalid ? errorId : null, ...describedBy].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  return {
    ...(invalid ? { "aria-invalid": true as const } : {}),
    ...(ids.length > 0 ? { "aria-describedby": ids.join(" ") } : {}),
  };
}
