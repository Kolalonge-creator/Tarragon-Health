"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addBpDevice, reviewBpDevice } from "./actions";

const TOUCH = "min-h-11";

export function AddDeviceForm() {
  const [state, action, busy] = useActionState(addBpDevice, undefined);
  return (
    <form action={action} className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Add a blood pressure monitor</p>
      <p className="text-sm text-charcoal-ink/70">
        Type only what a public validation registry (for example ValidateBP or STRIDE BP) shows. A new row is not shown to patients until the Chief Medical Officer reviews it.
      </p>
      <label className="block text-sm">Model name<Input name="device_name" required minLength={4} maxLength={120} className={TOUCH} /></label>
      <label className="block text-sm">Maker (optional)<Input name="vendor_name" maxLength={120} className={TOUCH} /></label>
      <label className="block text-sm">Link to the validation entry<Input name="validated_source_url" type="url" required className={TOUCH} /></label>
      <label className="block text-sm">
        Where the validation was found
        <select name="validation_basis" required defaultValue="" className={`${TOUCH} w-full rounded-md border bg-background px-2`}>
          <option value="" disabled>Choose</option>
          <option value="validatebp">A validation registry (for example ValidateBP)</option>
          <option value="published_validation_study">A published validation study</option>
        </select>
      </label>
      <label className="block text-sm">NAFDAC number (optional if a distributor is named)<Input name="nafdac_number" maxLength={60} className={TOUCH} /></label>
      <label className="block text-sm">Authorised distributor in Nigeria (optional if a NAFDAC number is given)<Input name="authorised_distributor" maxLength={120} className={TOUCH} /></label>
      <label className="block text-sm">One line on why it is listed (optional)<Input name="description" maxLength={300} className={TOUCH} /></label>
      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-sm text-green-800">Added. It waits for review by the Chief Medical Officer.</p> : null}
      <Button type="submit" className={TOUCH} disabled={busy}>Add the monitor</Button>
    </form>
  );
}

export function ReviewDeviceForm({ id, reviewed }: { id: string; reviewed: boolean }) {
  const [state, action, busy] = useActionState(reviewBpDevice, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="reviewed" value={reviewed ? "no" : "yes"} />
      <label className="block text-sm">
        {reviewed ? "Why you are withdrawing the review (optional)" : "What you checked, in a sentence"}
        <Input name="note" maxLength={500} required={!reviewed} minLength={reviewed ? undefined : 10} className={TOUCH} />
      </label>
      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-sm text-green-800">Done.</p> : null}
      <Button type="submit" variant={reviewed ? "outline" : "default"} className={TOUCH} disabled={busy}>
        {reviewed ? "Withdraw my review" : "I checked this monitor in the registry"}
      </Button>
    </form>
  );
}
