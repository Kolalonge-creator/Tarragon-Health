import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Plain-language transparency about AI-assisted doctor review — surfaced
 * per the founder-confirmed PHI-to-Anthropic posture (case_briefs,
 * 20260730121004 / 20260730123735) but never previously disclosed anywhere
 * a patient could see it. A static disclosure, not a per-patient query:
 * the practice applies platform-wide, not conditionally per patient.
 *
 * Deliberately states the safety line plainly rather than burying it in
 * legal copy — "AI drafts, never decides" is the actual guardrail on
 * case_briefs (no diagnosis, no prescribing, no closing an escalation; a
 * doctor's own reviewed_by/reviewed_at is what makes anything official).
 */
export function AiUsageDisclosure() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.preventive className="h-4 w-4 text-brand-green" aria-hidden />
          How your care team uses AI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-charcoal-ink/70">
        <p>
          To help your doctor review your case faster, we sometimes use an AI tool to draft a
          short summary of your recent record — things like your readings, medications, and past
          follow-ups.
        </p>
        <p>
          The AI only ever drafts. It never diagnoses, never prescribes, and never closes a case —
          a real doctor always reviews it and makes the decision, the same as every other part of
          your care.
        </p>
      </CardContent>
    </Card>
  );
}
