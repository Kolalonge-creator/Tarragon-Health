import { z } from "zod";

/**
 * Shared structural Zod validation for the predicate DSL
 * (lib/rules/predicate.ts) — one schema reused everywhere a predicate is
 * accepted as admin-authored input (risk questionnaire scoring rules,
 * prevention campaign eligibility), so the two can never drift apart.
 */
export const predicateSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("true") }),
    z.object({ op: z.literal("false") }),
    z.object({ op: z.literal("eq"), field: z.string().min(1), value: z.unknown() }),
    z.object({ op: z.literal("neq"), field: z.string().min(1), value: z.unknown() }),
    z.object({ op: z.literal("in"), field: z.string().min(1), value: z.array(z.unknown()) }),
    z.object({ op: z.literal("includes"), field: z.string().min(1), value: z.unknown() }),
    z.object({ op: z.literal("gte"), field: z.string().min(1), value: z.number() }),
    z.object({ op: z.literal("lte"), field: z.string().min(1), value: z.number() }),
    z.object({ op: z.literal("gt"), field: z.string().min(1), value: z.number() }),
    z.object({ op: z.literal("lt"), field: z.string().min(1), value: z.number() }),
    z.object({ op: z.literal("and"), clauses: z.array(predicateSchema).min(1) }),
    z.object({ op: z.literal("or"), clauses: z.array(predicateSchema).min(1) }),
    z.object({ op: z.literal("not"), clause: predicateSchema }),
  ])
);
