import { Badge } from "@/components/ui/badge";

/**
 * MINIMAL AiLabel created by S89 on branch s89/previsit-brief-ai-marking-omission-flags. Another branch is adding a shared `AiLabel`;
 * when both land, keep that one and delete this file, then repoint the imports in `components/ai/ai-draft-block.tsx`,
 * `components/scribe/draft-review-panel.tsx` and `components/draft-reply-card.tsx`.
 *
 * Says an output is AI-drafted. It never claims a doctor reviewed anything: a "reviewed by" claim must come from the null-gated
 * ReviewedByDoctor component and a real reviewed_by/reviewed_at record.
 */
export function AiLabel({ reviewed = false }: { reviewed?: boolean }) {
  return (
    <Badge variant="grey" data-testid="ai-label">
      {reviewed ? "AI-drafted, text reviewed" : "AI-drafted, not yet reviewed"}
    </Badge>
  );
}
