"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  reportAiAnswerAction,
  type ReportAiAnswerState,
} from "@/lib/ai-governance/report-actions";

/**
 * "Something wrong with that answer?" — the patient- and clinician-facing end
 * of Module 40.12.
 *
 * Written in the brand voice deliberately: no "WARNING", no form that reads
 * like an incident report, no severity dropdown. The person using this has
 * just been told something that felt wrong by a health app, and the whole
 * value of this control is that they use it. Severity, category refinement
 * and clinical judgement all happen later, on the governance console, by a
 * clinician.
 */

/** Plain-language categories, mapped to the ai_incident_category enum. */
const REPORT_REASONS = [
  { value: "incorrect_information", label: "The information was wrong" },
  { value: "inappropriate_recommendation", label: "The advice did not feel right" },
  { value: "missed_escalation", label: "It missed something urgent" },
  { value: "fabricated_citation", label: "It referred to something that does not exist" },
  { value: "privacy_concern", label: "It said something about me it should not have" },
  { value: "other", label: "Something else" },
] as const;

export function ReportAiAnswer({
  systemCode,
  interactionId,
  label = "Something not right about that answer?",
}: {
  systemCode: string;
  /**
   * The specific AI interaction being reported, when the caller knows it. A
   * report that names the exact turn is worth far more to an investigation
   * than one that does not — but a report with no id is still filed, because
   * losing it entirely would be the worse outcome.
   */
  interactionId?: string | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ReportAiAnswerState, FormData>(
    reportAiAnswerAction,
    { status: "idle" }
  );

  if (state.status === "sent") {
    return (
      <p className="text-xs text-brand-green">
        Thank you. Your care team has this. Someone will look at it.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-charcoal-ink/60 underline underline-offset-2 hover:text-charcoal-ink"
      >
        {label}
      </button>
    );
  }

  return (
    <form action={action} className="space-y-2 rounded-lg border border-charcoal-ink/10 bg-white p-3">
      <input type="hidden" name="systemCode" value={systemCode} />
      {interactionId && <input type="hidden" name="interactionId" value={interactionId} />}

      <div>
        <Label htmlFor={`ai-report-reason-${systemCode}`}>What went wrong?</Label>
        <Select
          id={`ai-report-reason-${systemCode}`}
          name="category"
          defaultValue="incorrect_information"
        >
          {REPORT_REASONS.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor={`ai-report-detail-${systemCode}`}>In your own words</Label>
        <Textarea
          id={`ai-report-detail-${systemCode}`}
          name="description"
          rows={3}
          required
          placeholder="A sentence is plenty."
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      {state.status === "error" && <p className="text-sm text-red-600">{state.message}</p>}
    </form>
  );
}
