/**
 * A tiny strict reader for the JSON the Community functions return.
 *
 * apps/mobile does not depend on zod, so this is the smallest thing that does the same job for model.ts: every reply is PARSED, never
 * trusted. A reply that does not match its shape gives `undefined`, and the caller treats that as "nothing to show", never as half a
 * screen. Unknown extra keys are ignored (like zod's default), a wrong type or a missing required key is a failure.
 */
export type Parser<T> = (input: unknown) => { ok: true; value: T } | { ok: false };

const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const fail = { ok: false } as const;

export type Infer<P> = P extends Parser<infer T> ? T : never;

export const isRecord = (u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null && !Array.isArray(u);

export const string: Parser<string> = (u) => (typeof u === "string" ? ok(u) : fail);
export const boolean: Parser<boolean> = (u) => (typeof u === "boolean" ? ok(u) : fail);
export const int: Parser<number> = (u) => (typeof u === "number" && Number.isInteger(u) ? ok(u) : fail);
export const nonNegativeInt: Parser<number> = (u) => (typeof u === "number" && Number.isInteger(u) && u >= 0 ? ok(u) : fail);
export const positiveInt: Parser<number> = (u) => (typeof u === "number" && Number.isInteger(u) && u > 0 ? ok(u) : fail);

export function literal<const V extends string | boolean>(expected: V): Parser<V> {
  return (u) => (u === expected ? ok(expected) : fail);
}

export function oneOf<const V extends string>(allowed: readonly V[]): Parser<V> {
  return (u) => (typeof u === "string" && (allowed as readonly string[]).includes(u) ? ok(u as V) : fail);
}

export function nullable<T>(p: Parser<T>): Parser<T | null> {
  return (u) => (u === null ? ok(null) : p(u));
}

/** A key that may be absent (or null is NOT accepted: use nullable for that). */
export function optional<T>(p: Parser<T>): Parser<T | undefined> {
  return (u) => (u === undefined ? ok(undefined) : p(u));
}

/** A key that may be absent, in which case `fallback` is used. */
export function withDefault<T>(p: Parser<T>, fallback: T): Parser<T> {
  return (u) => (u === undefined ? ok(fallback) : p(u));
}

export function array<T>(p: Parser<T>): Parser<T[]> {
  return (u) => {
    if (!Array.isArray(u)) return fail;
    const out: T[] = [];
    for (const item of u as unknown[]) {
      const r = p(item);
      if (!r.ok) return fail;
      out.push(r.value);
    }
    return ok(out);
  };
}

export function object<S extends Record<string, Parser<unknown>>>(shape: S): Parser<{ [K in keyof S]: Infer<S[K]> }> {
  return (u) => {
    if (!isRecord(u)) return fail;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      const r = shape[key]!(u[key]);
      if (!r.ok) return fail;
      if (r.value !== undefined) out[key] = r.value;
    }
    return ok(out as { [K in keyof S]: Infer<S[K]> });
  };
}

/** Parse, returning undefined on any mismatch. */
export function parse<T>(p: Parser<T>, input: unknown): T | undefined {
  const r = p(input);
  return r.ok ? r.value : undefined;
}
