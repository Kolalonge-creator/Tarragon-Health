import { jest } from "@jest/globals";

/**
 * Minimal chainable Supabase query-builder mock, shared across this
 * directory's tests. Every chain method (`eq`, `order`, `limit`, ...)
 * returns the same object so calls compose in any order; awaiting the
 * object (or calling `.single()`/`.maybeSingle()`) resolves to `result`.
 * Not a `.test.ts` file itself, so jest never tries to run it as a suite.
 */
export function chainable<T>(result: T) {
  const obj: Record<string, unknown> = {};
  const chainMethods = [
    "select",
    "insert",
    "update",
    "eq",
    "neq",
    "not",
    "gte",
    "lte",
    "gt",
    "lt",
    "order",
    "limit",
    "is",
    "in",
  ];
  for (const method of chainMethods) {
    obj[method] = jest.fn(() => obj);
  }
  obj.single = jest.fn(async () => result);
  obj.maybeSingle = jest.fn(async () => result);
  // Duck-typed thenable so `await builder` resolves to `result` even when
  // no terminal method (`single`/`maybeSingle`) is called — matches how
  // the real supabase-js query builder resolves directly to { data, error }.
  obj.then = (resolve: (value: T) => unknown) => resolve(result);
  return obj;
}

/** Builds a fake `supabase.from(table)` that dispatches to a different
 * canned result per table name — for functions like loadPatientContext
 * that read several tables in one call. */
export function fakeSupabaseFrom(resultsByTable: Record<string, unknown>) {
  return jest.fn((table: string) => chainable(resultsByTable[table] ?? { data: null, error: null }));
}
