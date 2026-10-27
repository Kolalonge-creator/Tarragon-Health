import { AI_LABEL_TEXT, type AiLabelVariant } from "@tarragon/i18n";
import { Badge } from "@/components/ui/badge";

/**
 * The shared label for model-generated text (Part C scan rule `ai-label`). The words come from `@tarragon/i18n`
 * (`AI_LABEL_TEXT`), so no screen types its own. There is deliberately no prop that hides it: an unlabelled AI
 * answer is the unsafe state. Never style it like a doctor's review (`ReviewedByDoctor`).
 */
export function AiLabel({
  variant = "drafted",
  tone = "grey",
}: {
  variant?: AiLabelVariant;
  tone?: "grey" | "amber";
}) {
  return (
    <span data-testid="ai-label">
      <Badge variant={tone}>{AI_LABEL_TEXT[variant]}</Badge>
    </span>
  );
}
