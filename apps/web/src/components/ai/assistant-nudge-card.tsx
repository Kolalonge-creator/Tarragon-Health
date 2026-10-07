"use client";

import Link from "next/link";
import { useAssistantNudges } from "@/lib/queries/ai-coach";

/** S51 (7.5): today's one nudge and the weekly reflection, from the patient's own data. Renders nothing while the assistant is closed. */
export function AssistantNudgeCard() {
  const { data } = useAssistantNudges();
  if (!data || !data.open) return null;
  return (
    <div className="space-y-2 rounded-md border border-brand-green/30 bg-brand-green/5 p-3" data-testid="assistant-nudge">
      <p className="text-sm text-charcoal-ink dark:text-night-ink">{data.daily.text}</p>
      <Link href={data.daily.target.path} className="inline-block text-xs text-brand-green dark:text-brand-green-bright underline">
        Open
      </Link>
      <details className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
        <summary className="cursor-pointer">Your week</summary>
        <p className="pt-1">{data.weekly.text}</p>
      </details>
    </div>
  );
}
