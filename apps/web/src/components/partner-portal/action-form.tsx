"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PartnerActionState } from "@/lib/partner-network/actions";

export type ActionField = {
  name: string;
  label: string;
  kind?: "text" | "textarea" | "select" | "month" | "checkbox";
  placeholder?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
};

/**
 * One small form that runs one server action. The action validates again and the database decides; this component only collects the words and
 * shows the answer in plain language. It never shows a database code.
 */
export function ActionForm({
  action,
  hidden,
  fields,
  submitLabel,
  variant,
  successText = "Done.",
  compact = false,
}: {
  action: (prev: PartnerActionState, formData: FormData) => Promise<PartnerActionState>;
  hidden?: Record<string, string>;
  fields: readonly ActionField[];
  submitLabel: string;
  variant?: "outline";
  successText?: string;
  compact?: boolean;
}) {
  const [state, run, pending] = useActionState<PartnerActionState, FormData>(action, undefined);
  return (
    <form action={run} className={compact ? "flex flex-wrap items-end gap-2" : "space-y-3"}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => {
        const id = `${f.name}-${Object.values(hidden ?? {}).join("").slice(0, 8)}`;
        if (f.kind === "checkbox") {
          return (
            <label key={f.name} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={f.name} defaultChecked={f.defaultValue === "on"} /> {f.label}
            </label>
          );
        }
        return (
          <div key={f.name} className="space-y-1">
            <Label htmlFor={id}>{f.label}</Label>
            {f.kind === "textarea" ? (
              <Textarea id={id} name={f.name} rows={3} placeholder={f.placeholder} required={f.required ?? true} defaultValue={f.defaultValue} />
            ) : f.kind === "select" ? (
              <select id={id} name={f.name} required={f.required ?? true} defaultValue={f.defaultValue ?? ""} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="" disabled>{f.placeholder ?? "Choose"}</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <Input id={id} name={f.name} type={f.kind === "month" ? "month" : "text"} placeholder={f.placeholder} required={f.required ?? true} defaultValue={f.defaultValue} />
            )}
            {f.hint && <p className="text-xs text-charcoal-ink/60">{f.hint}</p>}
          </div>
        );
      })}
      <Button type="submit" size="sm" variant={variant} disabled={pending}>{pending ? "Working..." : submitLabel}</Button>
      {state?.error && <p role="alert" className="w-full text-sm text-red-600">{state.error}</p>}
      {state?.success && <p role="status" className="w-full text-sm text-brand-green">{successText}</p>}
    </form>
  );
}
