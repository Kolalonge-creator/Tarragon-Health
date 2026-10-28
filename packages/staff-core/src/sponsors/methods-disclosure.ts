import { z } from "zod";

/**
 * The "Methods and funding" disclosure a sponsor reads beside its programme figures (GAP-71). It states who sponsors and who produced the figures,
 * which definition versions were used and whether they are signed, the minimum-cell rule, who is left out, and whether the figures were independently
 * reviewed. Parsed, never trusted. It holds no person and no count of any person. While the go-live guard is off the database says it is withheld and
 * nothing is shown (not even a heading).
 */
const definition = z.object({
  version: z.number().int().nullable(),
  status: z.enum(["signed", "proposed_not_signed", "none_defined"]),
  status_text: z.string().optional(),
  signed_on: z.string().nullable().optional(),
});
const review = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_independently_reviewed"), text: z.string() }),
  z.object({ status: z.literal("independently_reviewed"), text: z.string(), reviewer: z.string(), organisation: z.string(), reviewed_on: z.string(), scope: z.string() }),
]);
const methodsSchema = z.union([
  z.object({ withheld: z.literal(true), reason: z.string() }),
  z.object({
    withheld: z.literal(false),
    wording_version: z.number().int(),
    funding: z.object({ sponsor: z.string().nullable(), produced_by: z.string(), text: z.string() }),
    definitions: z.object({ text: z.string(), outcome_measures: definition, cascade_of_care: definition }),
    minimum_cell: z.object({ minimum: z.number().int().nullable(), text: z.string() }),
    exclusions: z.object({ applied_by_the_definition_in_use: z.boolean(), text: z.string() }),
    review,
    descriptive_note: z.string(),
  }),
]);
const replySchema = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), methods: methodsSchema }), z.object({ ok: z.literal(false) })]);
export type Methods = z.infer<typeof methodsSchema>;

/** The disclosure, or null when the reply is not one (a failed read is never shown as "no disclosure"). `shown: false` means the database withheld it. */
export function parseMethodsDisclosure(data: unknown): { shown: false } | { shown: true; methods: Extract<Methods, { withheld: false }> } | null {
  const r = replySchema.safeParse(data);
  if (!r.success || !r.data.ok) return null;
  return r.data.methods.withheld ? { shown: false } : { shown: true, methods: r.data.methods };
}

export type MethodsRpc = (fn: "sponsor_methods_disclosure", args: { p_cohort: string }) => PromiseLike<{ data: unknown; error: unknown }>;
export type MethodsLoad = { state: "unavailable" } | { state: "off" } | { state: "shown"; methods: Extract<Methods, { withheld: false }> };

/** One programme's disclosure. A failed read is "unavailable", distinct from "off" (guard not switched on). */
export async function loadMethodsDisclosure(rpc: MethodsRpc, cohortId: string): Promise<MethodsLoad> {
  const res = await rpc("sponsor_methods_disclosure", { p_cohort: cohortId });
  const parsed = res.error ? null : parseMethodsDisclosure(res.data);
  if (!parsed) return { state: "unavailable" };
  return parsed.shown ? { state: "shown", methods: parsed.methods } : { state: "off" };
}

const definitionLine = (label: string, d: z.infer<typeof definition>): string =>
  d.status === "none_defined" ? `${label}: no definition version is in use.` : `${label}: version ${d.version}. ${d.status_text ?? (d.status === "signed" ? "Signed" : "Proposed, not signed")}.`;

/** Plain lines for the page, in reading order. */
export function describeMethods(m: Extract<Methods, { withheld: false }>): { title: string; lines: string[] } {
  return {
    title: "Methods and funding",
    lines: [
      m.funding.text,
      m.definitions.text,
      definitionLine("Outcome measures", m.definitions.outcome_measures),
      definitionLine("Cascade of care", m.definitions.cascade_of_care),
      m.minimum_cell.text,
      m.exclusions.text,
      m.review.text,
      m.descriptive_note,
    ],
  };
}
