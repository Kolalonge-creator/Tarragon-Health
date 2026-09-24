import Link from "next/link";
import type { CareTeamHandoffState } from "@/lib/ai-coach/use-care-team-handoff";

/**
 * The pending/done/error copy for §78.12's "I want to speak to someone"
 * handoff -- paired with useCareTeamHandoff. Deliberately does not render
 * the "idle" state: each caller (ai-coach-chat.tsx, ask-tarragon-card.tsx)
 * places its own idle-state button in its own layout, styled to match its
 * surrounding row -- only the stateful follow-up copy is shared, since that
 * is the piece that actually drifted between the two surfaces before (see
 * useCareTeamHandoff's own header comment).
 */
export function CareTeamHandoffStatus({ handoff }: { handoff: CareTeamHandoffState }) {
  if (handoff.status === "pending") {
    return (
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        Starting a conversation with your care team…
      </p>
    );
  }
  if (handoff.status === "done") {
    return (
      <p className="text-xs text-charcoal-ink dark:text-night-ink">
        Sent. Your care team has what you&apos;ve talked about here.{" "}
        <Link href="/patient/messages" className="text-brand-green dark:text-brand-green-bright underline">
          Continue in Messages
        </Link>
        .
      </p>
    );
  }
  if (handoff.status === "error") {
    return (
      <p className="text-xs text-red-600 dark:text-red-300">
        {handoff.error}. You can also message your care team directly from{" "}
        <Link href="/patient/messages" className="underline">
          Messages
        </Link>
        .
      </p>
    );
  }
  return null;
}
