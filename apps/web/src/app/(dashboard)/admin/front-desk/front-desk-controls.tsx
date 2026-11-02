"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { generateReportNowAction, setAssistantSwitchAction, setSamplePercentAction, type FrontDeskActionState } from "./actions";

function Result({ state }: { state: FrontDeskActionState }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="text-sm text-red-700">{state.error}</p>;
  return <p role="status" className="text-sm text-deep-forest">{state.done}</p>;
}

/** The kill switch. Turning it off is one click; turning it on again is one click. */
export function AssistantSwitch({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(setAssistantSwitchAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <Button type="submit" variant={enabled ? "outline" : "default"} disabled={pending}>
        {pending ? "Saving…" : enabled ? "Turn the assistant off" : "Turn the assistant on"}
      </Button>
      <Result state={state} />
    </form>
  );
}

const SHARES = [
  { value: "0", label: "Only flagged and handed-off" },
  { value: "10", label: "10% of the rest (default)" },
  { value: "25", label: "25% of the rest" },
  { value: "50", label: "50% of the rest" },
  { value: "100", label: "Everything (the live pilot)" },
];

export function SampleShare({ current }: { current: number | null }) {
  const [state, action, pending] = useActionState(setSamplePercentAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <label className="block text-sm font-medium">
        How much ordinary traffic to review
        <select name="percent" defaultValue={current === null ? "10" : String(current)} className="mt-1 block w-full max-w-xs rounded-md border border-charcoal-ink/25 bg-white px-3 py-2 text-sm dark:bg-night-card">
          {SHARES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      <Result state={state} />
    </form>
  );
}

export function ReportNow() {
  const [state, action, pending] = useActionState(generateReportNowAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Making the report…" : "Email me a report now"}</Button>
      <Result state={state} />
    </form>
  );
}
