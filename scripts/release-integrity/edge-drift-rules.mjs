// Rules for the edge function drift check (check-edge-function-drift.mjs).
//
// A module that holds only types (`export type`, `export interface`, `import type`) has no runtime, so when a function is deployed through
// the Supabase API bundler (the path used when Docker is not running) the bundler emits it as an EMPTY file, and `functions download` returns
// zero bytes. The deployed code is correct, but a byte comparison against the committed file reports it as drift every time. This is the only
// difference we forgive: an empty deployed file against a committed file with no runtime statements.

/** Removes block and line comments (good enough for the type-only modules we have; it is not a TypeScript parser). */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** True when the source has no runtime statement: only type imports/exports, interfaces and type aliases. */
export function isTypesOnlyModule(source) {
  const code = stripComments(source);
  if (code.trim() === "") return true;
  // Any top-level value declaration or value re-export is runtime.
  if (/^\s*(export\s+)?(declare\s+)?(const|let|var|function|class|enum|abstract\s+class)\b/m.test(code)) return false;
  if (/^\s*export\s+default\b/m.test(code)) return false;
  if (/^\s*export\s+\*/m.test(code)) return false;
  if (/^\s*export\s*\{/m.test(code)) return false;
  // An import that is not `import type` pulls in a runtime module.
  if (/^\s*import\s+(?!type\b)/m.test(code)) return false;
  return true;
}

/** True when a deployed/committed pair differs only because the bundler emptied a types-only module. */
export function isBundlerEmptiedTypesModule(deployed, committed) {
  return deployed.trim() === "" && committed.trim() !== "" && isTypesOnlyModule(committed);
}

// Files the bundler never ships, so "committed but never deployed" is expected rather than drift:
//  1. test files and test fakes (`*.test.ts`, `test-fake-*.ts`), which no function imports;
//  2. shared modules that no deployed file imports (the bundler ships only the import graph).
// A shared module that IS imported by a deployed file but missing from the deployment is still reported.

/** True for a test file or test fake. */
export function isTestFile(rel) {
  const name = rel.split("/").pop() ?? rel;
  return /\.test\.[cm]?[jt]sx?$/.test(name) || /^test-fake-.*\.[cm]?[jt]sx?$/.test(name);
}

function normalise(parts) {
  const out = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** Relative paths (as written, resolved against `fromRel`'s directory) of every relative import/export-from in a source. */
export function relativeImports(fromRel, source) {
  const dir = fromRel.split("/").slice(0, -1);
  const found = [];
  const re = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) found.push(normalise([...dir, ...m[1].split("/")]));
  return found;
}

/** Set of paths imported (directly) by any of the given deployed files; `deployed` maps relative path to source text. */
export function importedPaths(deployed) {
  const set = new Set();
  for (const [rel, text] of Object.entries(deployed)) for (const p of relativeImports(rel, text)) set.add(p);
  return set;
}

/** True when a committed-only file is expected not to be deployed: a test file, or a module nothing deployed imports. */
export function isExpectedUndeployed(rel, imported) {
  if (isTestFile(rel)) return true;
  // Only shared modules qualify: a function's own files (index.ts, handler.ts) missing from the deployment is real drift.
  return rel.startsWith("_shared/") && !imported.has(rel);
}
