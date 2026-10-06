"use client";

import { useState } from "react";
import { approveProtocolAction } from "./actions";

/** Approval is two steps: the first press only shows what approving means; nothing is sent until the confirm form is submitted. */
export function ApproveForm({ id, version }: { id: string; version: number }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
        Approve version {version}
      </button>
    );
  }
  return (
    <form action={approveProtocolAction} className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-amber-900">
        Approving makes this the step table the evaluator may use for real patients. It retires the previous approved version. It cannot be edited afterwards; a change needs a new version.
      </p>
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="confirmed" value="yes" required className="mt-1" />
        <span>I have read every step above and I approve this step table for use with patients.</span>
      </label>
      <label className="block text-sm text-charcoal-ink">
        Note (optional)
        <textarea name="note" rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm" />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
          Confirm approval of version {version}
        </button>
        <button type="button" onClick={() => setAsking(false)} className="rounded-lg border border-charcoal-ink/20 px-4 py-2 text-sm text-charcoal-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}
