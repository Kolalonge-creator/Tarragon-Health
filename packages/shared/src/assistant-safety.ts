import { getProposedConfig } from "./proposed-config";

/**
 * INV-04 (S51): app-side twin of private.is_ai_excluded_analyte. A screening analyte (HIV, HBsAg, HCV) is never given to the
 * assistant or the result explainer unless it is an explicit negative. Fail safe: unknown, blank, positive, reactive or numeric
 * all count as excluded. The database views ai_readable_lab_* apply the same rule; this is defence in depth for any other source.
 */
const NEGATIVES = new Set(["negative", "non-reactive", "non reactive", "nonreactive", "not detected"]);

export function aiExcludedTokens(): readonly string[] {
  return getProposedConfig<readonly string[]>("assistant.excluded_analytes").value as readonly string[];
}

export function isAiExcludedAnalyte(code: string | null | undefined, valueText: string | null | undefined): boolean {
  const norm = (code ?? "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
  const isScreening = aiExcludedTokens().some((t) => norm.includes(t));
  if (!isScreening) return false;
  return !NEGATIVES.has((valueText ?? "").trim().toLowerCase());
}
