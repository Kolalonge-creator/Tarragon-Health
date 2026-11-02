import type { PartCViolation } from "./scan";

/**
 * Where a person sees what each registered AI system writes, and the checks that keep that map honest (Part C rule `ai-label`).
 *
 * The authority is the code-side registry (`AI_SYSTEMS` in `apps/web/src/lib/ai-governance/system-codes.ts`, which a registration
 * migration keeps equal to `public.ai_systems`). A hand list of screens cannot notice a new AI system, so the checks start from the
 * registry and from the files that actually call `runGovernedAi`:
 *
 *  1. every registered system code must appear in `AI_SYSTEM_SURFACES`, either with the screens that show its output (each must
 *     render the shared label, and `AI_SURFACES` is derived from them) or with the reason no model-written prose reaches a person;
 *  2. every map entry must still name a registered system (no stale entry);
 *  3. every file that calls `runGovernedAi` must name a registered system (`AI_SYSTEMS.<key>`), so a call site cannot hide from (1);
 *  4. every component that imports a call site, or a server action that imports one, or fetches a call-site API route, must be a
 *     listed surface or carry a written reason in `AI_SURFACE_REVIEWED`. That catches a new screen over an existing system.
 *
 * It is a source heuristic (imports and names), not proof that nothing is missed: a screen that reaches a call site through two
 * or more layers of plain helpers is not found. The screen tests next to each component prove what is on screen.
 */
export type AiSystemSurface =
  | { readonly surfaces: readonly string[] }
  /** The reason a person never sees model-written prose from this system (structured suggestions they confirm, scores, context). */
  | { readonly noText: string };

const WEB = "apps/web/src";
const CONFIRM_FIELDS = "Reads a photo into suggested fields the person checks and confirms one by one; no model-written prose is shown.";

export const AI_SYSTEM_SURFACES: Readonly<Record<string, AiSystemSurface>> = {
  "AI-001": { surfaces: [`${WEB}/app/(dashboard)/patient/ai-coach-chat.tsx`, "apps/mobile/src/screens/sections/ai-coach-screen.tsx"] },
  "AI-002": {
    noText:
      "The nudge is delivered through the notification pipeline (tone guard and neutral lint), not rendered on a screen of its own. Labelling notification text is OQ-733.",
  },
  "AI-003": { surfaces: [`${WEB}/components/result-explainer.tsx`] },
  "AI-004": { surfaces: [`${WEB}/components/case-brief-card.tsx`] },
  "AI-005": { surfaces: [`${WEB}/app/(dashboard)/clinician/patients/[patientId]/lab-report-extraction-panel.tsx`] },
  "AI-006": {
    noText:
      "The patient card (AiEcgSummary over AiSummaryCard) shows the machine's own printed statement verbatim, with its own 'not a medical opinion' label; the model writes no prose.",
  },
  "AI-007": { noText: CONFIRM_FIELDS },
  "AI-008": { noText: CONFIRM_FIELDS },
  "AI-009": { noText: "Embeddings for retrieval; nothing is shown to a person." },
  "AI-010": { noText: "A risk score and its inputs; the number is shown by the risk screens, no model-written prose." },
  "AI-011": { surfaces: [`${WEB}/app/(dashboard)/patient/meal-plan-section.tsx`] },
  "AI-012": { surfaces: [`${WEB}/app/(dashboard)/patient/vaccination-card-import.tsx`] },
  "AI-013": { surfaces: [`${WEB}/app/(dashboard)/patient/video-visit/[consultationId]/appointment-prep-helper.tsx`] },
  "AI-014": { surfaces: [`${WEB}/components/draft-reply-card.tsx`] },
  "AI-015": { surfaces: [`${WEB}/app/(dashboard)/patient/service-navigation-assistant.tsx`] },
  "AI-016": {
    noText:
      "The patient card (AiImagingSummary over AiSummaryCard) shows the radiologist's own impression verbatim, with its own 'not a medical opinion' label; the model writes no prose.",
  },
  "AI-017": { surfaces: [`${WEB}/components/scribe/draft-review-panel.tsx`] },
  "AI-018": { noText: CONFIRM_FIELDS },
  "AI-019": {
    noText:
      "A draft paragraph on the unsigned report row for a clinician to edit and sign; the patient never sees the draft and the database wipes it on signature (INV-11).",
  },
  "AI-020": { noText: "The person's remembered goals, read into AI-001's context; shown only through the coach (AI-001)." },
  "AI-021": { noText: CONFIRM_FIELDS },
  "AI-022": { noText: CONFIRM_FIELDS },
  "AI-023": {
    noText:
      "Front Desk M1: registered, but no call site and no chat widget exist yet, so no model-written text reaches anyone. M4 replaces this entry with the website chat widget as a surface, which must render the shared AI label (a visitor is told they are talking to an AI assistant).",
  },
};

/** Every surface above that shows model-written text. Derived, so the map and the list cannot disagree. */
export const AI_SURFACES: readonly string[] = [
  ...new Set(Object.values(AI_SYSTEM_SURFACES).flatMap((v) => ("surfaces" in v ? v.surfaces : []))),
];

/**
 * Components that render the shared `AiLabel` on behalf of the screens that use them. A surface passes the label check when it
 * renders `AiLabel` itself OR renders one of these. Each name is resolved to its defining file at scan time and the scan checks
 * that file really renders `AiLabel`; a name with no defining file on this branch is skipped (so a component that lands on
 * another branch cannot fail this one while absent).
 */
export const RENDERS_AI_LABEL: readonly string[] = ["AiDraftBlock"];

export const AI_REGISTRY_FILE = `${WEB}/lib/ai-governance/system-codes.ts`;

/**
 * Components the call-site graph finds (they import a call site, a server action that imports one, or fetch a call-site API route)
 * that are deliberately NOT label surfaces, each with the reason. A new candidate fails until it is listed here or in a system's
 * `surfaces`. A stale entry (no longer a candidate) also fails, so this list tracks the code.
 */
export const AI_SURFACE_REVIEWED: Readonly<Record<string, string>> = {
  [`${WEB}/app/(dashboard)/patient/eating-plans-card.tsx`]:
    "S50a: only shares the nutrition actions file with the AI-008 meal photo call site. It shows CMO-signed plan text and swaps read from nutrition_guidance_config through my_nutrition_guidance(); no model-written prose.",
  "apps/mobile/src/screens/photo-reading-screen.tsx": "AI-022: proposes the numbers on a cuff display; the person confirms or edits them. No model-written prose.",
  "apps/mobile/src/screens/sections/tracker-screens.tsx": "AI-008 meal photo estimate: structured food items and nutrient numbers the person confirms; no model-written prose.",
  [`${WEB}/app/(dashboard)/patient/check-my-pack.tsx`]:
    "AI-007 reads the pack photo; the verdict text is a fixed lookup (VERDICT) from a deterministic name and strength comparison, never model prose.",
  [`${WEB}/app/(dashboard)/patient/pack-photo-prefill.tsx`]: "AI-007: prefills medication fields the person checks and saves; no model-written prose.",
  [`${WEB}/app/(dashboard)/patient/documents/page.tsx`]:
    "Server page: imports only the go-live guard constant from the AI-018 call site, then renders DocumentCapture (field suggestions confirmed one by one).",
  [`${WEB}/app/(dashboard)/patient/nutrition-flow.tsx`]: "AI-008 meal photo estimate: items matched to the food list, nutrient numbers the person confirms; no model-written prose.",
  [`${WEB}/app/(dashboard)/patient/nutrition-foundation.tsx`]: "Imports the deterministic nutrition foundation actions (analysis, favourites, barcode) that sit beside the AI-008 and AI-011 actions; shows no model output.",
  [`${WEB}/app/(dashboard)/patient/nutrition-support-card.tsx`]: "Imports only requestNutritionReferralAction, which sits in the file that also holds AI-008 and AI-011; shows no model output.",
};

export const registeredAiSystemCodes = (registrySource: string): string[] =>
  [...registrySource.matchAll(/^\s{2}\w+:\s*\{\s*\n\s*code:\s*"(AI-\d+)"/gm)].map((m) => m[1]);

const registeredKeys = (registrySource: string): string[] =>
  [...registrySource.matchAll(/^\s{2}(\w+):\s*\{\s*\n\s*code:\s*"AI-\d+"/gm)].map((m) => m[1]);

/** Checks 1 and 2: the map covers the registry exactly. */
export function scanAiSystemMap(
  registrySource: string,
  map: Readonly<Record<string, AiSystemSurface>> = AI_SYSTEM_SURFACES,
): PartCViolation[] {
  const out: PartCViolation[] = [];
  const codes = registeredAiSystemCodes(registrySource);
  const v = (file: string, text: string): PartCViolation => ({ rule: "ai-label", file, line: 1, text });
  for (const code of codes) {
    if (!map[code]) out.push(v(AI_REGISTRY_FILE, `${code} is registered but has no entry in AI_SYSTEM_SURFACES: say where its output is shown, or why no prose is`));
  }
  for (const [code, entry] of Object.entries(map)) {
    if (!codes.includes(code)) out.push(v("packages/shared/src/part-c-scan/ai-surfaces.ts", `${code} is in AI_SYSTEM_SURFACES but is not a registered AI system (stale entry)`));
    else if ("surfaces" in entry && entry.surfaces.length === 0) out.push(v("packages/shared/src/part-c-scan/ai-surfaces.ts", `${code} lists no surface: use noText with a reason`));
    else if ("noText" in entry && entry.noText.trim().length < 20) out.push(v("packages/shared/src/part-c-scan/ai-surfaces.ts", `${code} needs a real reason for noText`));
  }
  return out;
}

const COMMENT = /^\s*(\/\/|\/\*|\*|\{\s*\/\*)/;
const isTest = (f: string) => /\.(test|spec)\.tsx?$/.test(f);

/** Source files (not tests, not the governance module itself) that call `runGovernedAi` on a non-comment line. */
export function findAiCallSites(files: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [file, content] of files) {
    if (isTest(file) || file.startsWith(`${WEB}/lib/ai-governance/`) || file.startsWith("packages/shared/src/part-c-scan/")) continue;
    if (content.split("\n").some((l) => !COMMENT.test(l) && /\brunGovernedAi\b/.test(l))) out.push(file);
  }
  return out.sort();
}

/** Check 3: a call site must name a registered system, so it cannot sit outside the map. */
export function scanAiCallSites(files: ReadonlyMap<string, string>, registrySource: string): PartCViolation[] {
  const keys = new Set(registeredKeys(registrySource));
  const out: PartCViolation[] = [];
  for (const file of findAiCallSites(files)) {
    const content = files.get(file) ?? "";
    const named = [...content.matchAll(/\bAI_SYSTEMS\.(\w+)/g)].map((m) => m[1]);
    if (named.length === 0) out.push({ rule: "ai-label", file, line: 1, text: "calls runGovernedAi without naming a registered system (AI_SYSTEMS.<key>)" });
    for (const k of named) if (!keys.has(k)) out.push({ rule: "ai-label", file, line: 1, text: `names AI_SYSTEMS.${k}, which is not in the registry` });
  }
  return out;
}

const IMPORT_SPEC = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"] as const;
const ACTION_FILE = /(^|[/-])actions?\.tsx?$/;

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}
function normalise(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "." && seg !== "") out.push(seg);
  }
  return out.join("/");
}
function resolveImport(from: string, spec: string, files: ReadonlyMap<string, string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    const app = ["apps/web/src", "apps/mobile/src", "apps/console/src"].find((a) => from.startsWith(`${a}/`));
    if (!app) return null;
    base = `${app}/${spec.slice(2)}`;
  } else if (spec.startsWith(".")) base = normalise(`${dirname(from)}/${spec}`);
  else return null;
  for (const e of EXTENSIONS) if (files.has(base + e)) return base + e;
  return null;
}

/** `apps/web/src/app/api/x/y/route.ts` is fetched as "/api/x/y". */
function routePath(file: string): string | null {
  const m = file.match(/^apps\/web\/src\/app(\/api\/.+)\/route\.ts$/);
  return m ? m[1] : null;
}

/**
 * Check 4: the `.tsx` files that sit directly on an AI call site, one layer above it, or fetch its API route. Sorted.
 * (Direct import of a call-site file; import of a server-action file that imports one; a fetch of "/api/..." for a call-site route.)
 */
export function findAiRenderingCandidates(files: ReadonlyMap<string, string>): string[] {
  const sites = new Set(findAiCallSites(files));
  const importsOf = new Map<string, Set<string>>();
  for (const [file, content] of files) {
    if (isTest(file)) continue;
    const set = new Set<string>();
    for (const m of content.matchAll(IMPORT_SPEC)) {
      const r = resolveImport(file, m[1], files);
      if (r) set.add(r);
    }
    importsOf.set(file, set);
  }
  const actionSites = new Set<string>();
  for (const [file, imps] of importsOf) if (ACTION_FILE.test(file) && [...imps].some((i) => sites.has(i))) actionSites.add(file);
  const routes = [...sites].map(routePath).filter((r): r is string => r !== null);
  const out = new Set<string>();
  for (const [file, imps] of importsOf) {
    if (!file.endsWith(".tsx")) continue;
    if ([...imps].some((i) => sites.has(i) || actionSites.has(i))) out.add(file);
    else if (routes.some((r) => (files.get(file) ?? "").includes(r))) out.add(file);
  }
  // A mobile screen reaches the web call site through its own API client; the .ts client that fetches the route counts too.
  for (const [file, content] of files) {
    if (file.endsWith(".tsx") || isTest(file) || !file.startsWith("apps/mobile/src/")) continue;
    if (routes.some((r) => content.includes(r))) {
      for (const [other, imps] of importsOf) if (other.endsWith(".tsx") && imps.has(file)) out.add(other);
    }
  }
  return [...out].sort();
}

/** Check 4 verdicts. */
export function scanAiRenderingCandidates(
  files: ReadonlyMap<string, string>,
  surfaces: readonly string[] = AI_SURFACES,
  reviewed: Readonly<Record<string, string>> = AI_SURFACE_REVIEWED,
): PartCViolation[] {
  const candidates = findAiRenderingCandidates(files);
  const out: PartCViolation[] = [];
  for (const c of candidates) {
    if (!surfaces.includes(c) && !reviewed[c]) {
      out.push({ rule: "ai-label", file: c, line: 1, text: "sits on an AI call site: add it to its system's surfaces (and render AiLabel) or give it a reason in AI_SURFACE_REVIEWED" });
    }
  }
  for (const [file, reason] of Object.entries(reviewed)) {
    if (reason.trim().length < 20) out.push({ rule: "ai-label", file, line: 1, text: "AI_SURFACE_REVIEWED needs a real reason" });
    if (!candidates.includes(file)) out.push({ rule: "ai-label", file, line: 1, text: "AI_SURFACE_REVIEWED entry is no longer a candidate (stale): remove it" });
    if (surfaces.includes(file)) out.push({ rule: "ai-label", file, line: 1, text: "is both a surface and a reviewed non-surface: pick one" });
  }
  return out;
}
