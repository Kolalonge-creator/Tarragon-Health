import test from "node:test";
import assert from "node:assert/strict";
import { isTypesOnlyModule, isBundlerEmptiedTypesModule } from "./edge-drift-rules.mjs";

const typesOnly = `import type { ProviderResult } from "./result.ts";
/** doc */
export type Speaker = "clinician" | "patient";
export interface StartStreamInput { readonly encounterRef: string; }
// trailing comment
`;

test("a module of only type imports, aliases and interfaces is types-only", () => {
  assert.equal(isTypesOnlyModule(typesOnly), true);
});

test("any runtime statement makes a module runtime", () => {
  for (const src of [
    "export const x = 1;",
    "export function f() {}",
    "export class C {}",
    "export enum E { A }",
    "export default 1;",
    "export * from './a.ts';",
    "export { a } from './a.ts';",
    "import { a } from './a.ts';\nexport type T = typeof a;",
  ]) assert.equal(isTypesOnlyModule(src), false, src);
});

test("the empty deployed file is forgiven only for a types-only committed module", () => {
  assert.equal(isBundlerEmptiedTypesModule("", typesOnly), true);
  assert.equal(isBundlerEmptiedTypesModule("", "export const x = 1;"), false); // a runtime file that was emptied is real drift
  assert.equal(isBundlerEmptiedTypesModule("export type A = 1;", typesOnly), false); // non-empty and different is real drift
  assert.equal(isBundlerEmptiedTypesModule("", ""), false); // both empty: nothing to forgive (byte-equal anyway)
});

import { isTestFile, relativeImports, importedPaths, isExpectedUndeployed } from "./edge-drift-rules.mjs";

test("test files and fakes are recognised", () => {
  assert.equal(isTestFile("order-checkout/handler.test.ts"), true);
  assert.equal(isTestFile("paystack-webhook/test-fake-supabase.ts"), true);
  assert.equal(isTestFile("order-checkout/handler.ts"), false);
});

test("relative imports resolve against the importing file", () => {
  assert.deepEqual(relativeImports("order-checkout/index.ts", `import { a } from "../_shared/queue/fees.ts";`), ["_shared/queue/fees.ts"]);
  assert.deepEqual(relativeImports("a/b.ts", `export * from "./c.ts"; import x from "npm:foo";`), ["a/c.ts"]);
});

test("a shared module nothing deployed imports is expected undeployed; an imported one is not", () => {
  const imported = importedPaths({ "x/index.ts": `import { f } from "../_shared/used.ts";` });
  assert.equal(isExpectedUndeployed("_shared/unused.ts", imported), true);
  assert.equal(isExpectedUndeployed("_shared/used.ts", imported), false);
  assert.equal(isExpectedUndeployed("x/handler.test.ts", imported), true);
});

test("a function's own file that is not deployed is still drift", () => {
  assert.equal(isExpectedUndeployed("new-fn/index.ts", new Set()), false);
});

test("async functions and dynamic imports count as runtime", () => {
  assert.equal(isTypesOnlyModule("export async function f() {}"), false);
  assert.equal(isTypesOnlyModule("export namespace N { export const a = 1; }"), false);
  assert.deepEqual(relativeImports("a/b.ts", `const m = await import("../_shared/x.ts");`), ["_shared/x.ts"]);
});
