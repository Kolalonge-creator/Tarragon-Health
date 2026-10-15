"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { TestingActionState } from "@/lib/testing-days/actions";

type Action = (prev: TestingActionState, formData: FormData) => Promise<TestingActionState>;

/**
 * One small form around a server action, with its own pending and result line. `hidden` fields are sent as given; children
 * are the visible inputs. The result is announced politely (an alert for an error) so a screen reader hears it.
 */
export function ActionForm({
  action,
  hidden,
  submitLabel,
  children,
  variant,
  encType,
}: {
  action: Action;
  hidden?: Record<string, string>;
  submitLabel: string;
  children?: ReactNode;
  variant?: "default" | "outline";
  encType?: "multipart/form-data";
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} encType={encType} className="space-y-2">
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? "Working..." : submitLabel}
      </Button>
      {state?.error ? (
        <p role="alert" className="text-sm text-status-red">
          {state.error}
        </p>
      ) : null}
      {state?.message ? (
        <p role="status" className="text-sm text-brand-green">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
