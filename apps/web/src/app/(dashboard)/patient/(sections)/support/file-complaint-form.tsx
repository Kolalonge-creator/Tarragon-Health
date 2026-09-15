"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fileComplaint } from "./actions";
import { COMPLAINT_CATEGORY_LABEL, complaintCategorySchema } from "@/lib/validation/complaints";
import { complaintKeys } from "@/lib/queries/complaints";
import { Button } from "@/components/ui/button";

/** §24.14's complaint-filing form — a separate, more formal path than a ticket. */
export function FileComplaintForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState(fileComplaint, undefined);
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: complaintKeys.mine(patientId) });
    }
  }, [state?.success, queryClient, patientId]);

  const categories = complaintCategorySchema.options;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-sm font-medium text-charcoal-ink/70 underline underline-offset-2 hover:text-charcoal-ink"
      >
        Not satisfied with how something was handled? File a complaint
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-charcoal-ink/10 bg-white p-4">
      <div>
        <label htmlFor="complaint-category" className="mb-1 block text-sm font-medium text-charcoal-ink">
          Category
        </label>
        <select
          id="complaint-category"
          name="category"
          required
          className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
        >
          {categories.map((category) => (
            <option key={category} value={category}>
              {COMPLAINT_CATEGORY_LABEL[category]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="complaint-description" className="mb-1 block text-sm font-medium text-charcoal-ink">
          What happened?
        </label>
        <textarea
          id="complaint-description"
          name="description"
          required
          rows={4}
          maxLength={4000}
          className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && (
        <p className="text-sm text-brand-green">
          Received — we&apos;ll acknowledge this and follow up. You can track it below.
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "File complaint"}
      </Button>
    </form>
  );
}
