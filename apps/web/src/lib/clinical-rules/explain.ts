/**
 * §32.11 explainability: renders a rule's explanation_template against the
 * concrete facts of one evaluation. Deliberately simple string
 * interpolation (`{{path}}`) rather than a templating library — the inputs
 * are signed clinical text plus a flat fact object the engine itself
 * builds, so there is no case here that needs conditionals or loops in the
 * template.
 *
 * A token that resolves to nothing renders as `{{path: unavailable}}`
 * rather than throwing: one rule with a stale template referencing a field
 * that no longer exists must not take down the whole evaluation batch, but
 * it also must never render a plausible-looking sentence built on missing
 * data — the placeholder makes the gap visible in the audit trail instead.
 */
export function renderExplanation(template: string, facts: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, facts);
    if (value === undefined || value === null) {
      return `{{${path}: unavailable}}`;
    }
    return String(value);
  });
}
