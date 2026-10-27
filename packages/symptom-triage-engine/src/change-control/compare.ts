/**
 * Symptom knowledge base change control (S80d, Module 25.2): a read-only comparison of two stored triage protocol versions.
 *
 *  - `diffProtocols` lists what changed between two configs, pathway by pathway: red-flag rules added, removed or changed, question and outcome
 *    nodes added, removed or changed, and the fallback and start node.
 *  - `runRegression` replays the same deterministic probes against both versions and lists every probe whose answer changed. Probes are built from the
 *    rules and question graphs themselves: one capture per red-flag rule that satisfies exactly that rule, and one run down every answer path of every
 *    question graph (bounded). A change to a LESS urgent category is marked `loosened`, because a looser result is the dangerous direction.
 *  - It also reports `bundledFloorDrift` for the newer version: pathways whose red flags no longer equal the on-device floor the phone bundles.
 *
 * Pure. No database, no network, no clock. Nothing here activates, signs or edits a version: it only reads two configs the caller passes in.
 * The assistant's free-text emergency vignette set (packages/clinical, PR #1286) tests the free-text danger screen, which does not depend on a stored
 * protocol version, so it cannot be replayed through a structured config; it is run by its own test.
 */
import {
  categoryAtLeast,
  type OutcomeNode,
  type PresentingComplaintProtocol,
  type QuestionNode,
  type RedFlagRule,
  type SymptomCapture,
  type TriageCategory,
  type TriageProtocolConfig,
} from "../types/index";
import { runTriage } from "../engine/index";
import { bundledFloorDrift } from "../safety/floor-drift";

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------
export interface ChangedItem {
  readonly key: string;
  readonly what: string;
}

export interface PathwayDiff {
  readonly key: string;
  readonly label: string;
  readonly redFlagsAdded: readonly string[];
  readonly redFlagsRemoved: readonly string[];
  readonly redFlagsChanged: readonly ChangedItem[];
  readonly nodesAdded: readonly string[];
  readonly nodesRemoved: readonly string[];
  readonly nodesChanged: readonly ChangedItem[];
  readonly otherChanges: readonly string[];
}

export interface ProtocolDiff {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly pathwaysAdded: readonly string[];
  readonly pathwaysRemoved: readonly string[];
  readonly pathways: readonly PathwayDiff[];
  /** True when nothing at all differs. */
  readonly identical: boolean;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function describeRuleChange(a: RedFlagRule, b: RedFlagRule): string {
  const parts: string[] = [];
  if (a.category !== b.category) parts.push(`category ${a.category} to ${b.category}`);
  if (a.label !== b.label) parts.push("label reworded");
  if (!same(a.rule, b.rule)) parts.push(`condition changed (${JSON.stringify(a.rule)} to ${JSON.stringify(b.rule)})`);
  return parts.join("; ");
}

function describeNodeChange(a: QuestionNode | OutcomeNode, b: QuestionNode | OutcomeNode): string {
  if (a.type !== b.type) return `${a.type} became ${b.type}`;
  if (a.type === "outcome" && b.type === "outcome") {
    const parts: string[] = [];
    if (a.category !== b.category) parts.push(`category ${a.category} to ${b.category}`);
    if (a.clinicianReviewRequired !== b.clinicianReviewRequired) parts.push(`clinician review ${a.clinicianReviewRequired} to ${b.clinicianReviewRequired}`);
    if (a.safetyNetMessageKey !== b.safetyNetMessageKey) parts.push("safety-net message changed");
    if (a.rationale !== b.rationale) parts.push("rationale reworded");
    return parts.join("; ");
  }
  const parts: string[] = [];
  if ((a as QuestionNode).prompt !== (b as QuestionNode).prompt) parts.push("question reworded");
  if (!same({ ...a, prompt: "" }, { ...b, prompt: "" })) parts.push("answers or next steps changed");
  return parts.join("; ");
}

export function diffPathway(a: PresentingComplaintProtocol, b: PresentingComplaintProtocol): PathwayDiff {
  const ra = new Map(a.redFlagScreen.map((r) => [r.key, r]));
  const rb = new Map(b.redFlagScreen.map((r) => [r.key, r]));
  const redFlagsChanged: ChangedItem[] = [];
  for (const [k, ruleA] of ra) {
    const ruleB = rb.get(k);
    if (ruleB && !same(ruleA, ruleB)) redFlagsChanged.push({ key: k, what: describeRuleChange(ruleA, ruleB) });
  }
  const nodesChanged: ChangedItem[] = [];
  for (const [k, na] of Object.entries(a.nodes)) {
    const nb = b.nodes[k];
    if (nb && !same(na, nb)) nodesChanged.push({ key: k, what: describeNodeChange(na, nb) });
  }
  const other: string[] = [];
  if (a.startNodeKey !== b.startNodeKey) other.push(`start question ${a.startNodeKey} to ${b.startNodeKey}`);
  if (!same(a.fallbackOutcome, b.fallbackOutcome)) other.push("fallback outcome changed");
  if (a.label !== b.label) other.push("pathway renamed");
  for (const f of ["knownAssociatedSymptoms", "knownTriggers", "knownHistory"] as const) {
    if (!same(a[f], b[f])) other.push(`${f} vocabulary changed`);
  }
  return {
    key: a.key,
    label: b.label,
    redFlagsAdded: [...rb.keys()].filter((k) => !ra.has(k)),
    redFlagsRemoved: [...ra.keys()].filter((k) => !rb.has(k)),
    redFlagsChanged,
    nodesAdded: Object.keys(b.nodes).filter((k) => !(k in a.nodes)),
    nodesRemoved: Object.keys(a.nodes).filter((k) => !(k in b.nodes)),
    nodesChanged,
    otherChanges: other,
  };
}

const pathwayEmpty = (d: PathwayDiff): boolean =>
  d.redFlagsAdded.length + d.redFlagsRemoved.length + d.redFlagsChanged.length + d.nodesAdded.length + d.nodesRemoved.length + d.nodesChanged.length + d.otherChanges.length === 0;

export function diffProtocols(from: TriageProtocolConfig, to: TriageProtocolConfig): ProtocolDiff {
  const fa = new Map(from.pathways.map((p) => [p.key, p]));
  const fb = new Map(to.pathways.map((p) => [p.key, p]));
  const pathways: PathwayDiff[] = [];
  for (const [k, pa] of fa) {
    const pb = fb.get(k);
    if (!pb) continue;
    const d = diffPathway(pa, pb);
    if (!pathwayEmpty(d)) pathways.push(d);
  }
  const pathwaysAdded = [...fb.keys()].filter((k) => !fa.has(k));
  const pathwaysRemoved = [...fa.keys()].filter((k) => !fb.has(k));
  return { fromVersion: from.version, toVersion: to.version, pathwaysAdded, pathwaysRemoved, pathways, identical: pathways.length === 0 && pathwaysAdded.length === 0 && pathwaysRemoved.length === 0 };
}

// ---------------------------------------------------------------------------
// Regression
// ---------------------------------------------------------------------------
export interface Probe {
  readonly id: string;
  readonly pathway: string;
  readonly kind: "red_flag_rule" | "answer_path" | "clean_start";
  readonly label: string;
  readonly capture: SymptomCapture;
  readonly answers: Record<string, boolean | string>;
}

export interface ProbeOutcome {
  /** "incomplete" when the version still wants a question answered that the probe did not give. */
  readonly category: TriageCategory | "incomplete";
  readonly firedRedFlags: readonly string[];
}

export interface ChangedProbe {
  readonly probe: Probe;
  readonly before: ProbeOutcome;
  readonly after: ProbeOutcome;
  /** True when the newer version gives a LESS urgent answer than the older one (or stops giving an answer at all). */
  readonly loosened: boolean;
}

export interface RegressionReport {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly probesRun: number;
  readonly changed: readonly ChangedProbe[];
  readonly loosened: readonly ChangedProbe[];
  /** Pathways that exist in only one version, so nothing could be replayed for them. */
  readonly notReplayed: readonly string[];
  /** Pathways whose red flags in the newer version no longer equal the bundled on-device floor. */
  readonly bundledFloorDrift: readonly string[];
  readonly truncated: boolean;
}

const MAX_PATHS_PER_PATHWAY = 200;
const MAX_DEPTH = 14;

function cleanCapture(pathwayKey: string): SymptomCapture {
  return { presentingComplaintKey: pathwayKey, onset: "gradual", severity: 1, associatedSymptoms: [], triggers: [], relevantHistory: [], measurements: {} };
}

/** A capture that satisfies exactly the one rule (and nothing else it can avoid). */
export function captureForRule(pathwayKey: string, rule: RedFlagRule): SymptomCapture {
  const c = rule.rule;
  const cap: SymptomCapture = { ...cleanCapture(pathwayKey) };
  const measurements: Record<string, number> = {};
  if (c.measurementBelow) measurements[c.measurementBelow.key] = c.measurementBelow.value;
  if (c.measurementAtLeast) measurements[c.measurementAtLeast.key] = c.measurementAtLeast.value;
  return {
    ...cap,
    onset: c.onset ?? "gradual",
    severity: c.minSeverity ?? 1,
    associatedSymptoms: c.allAssociatedSymptoms ? [...c.allAssociatedSymptoms] : c.anyAssociatedSymptom?.[0] ? [c.anyAssociatedSymptom[0]] : [],
    triggers: c.anyTrigger?.[0] ? [c.anyTrigger[0]] : [],
    relevantHistory: c.anyHistory?.[0] ? [c.anyHistory[0]] : [],
    measurements,
  };
}

function enumeratePaths(p: PresentingComplaintProtocol): { paths: Record<string, boolean | string>[]; truncated: boolean } {
  const out: Record<string, boolean | string>[] = [];
  let truncated = false;
  const walk = (nodeKey: string, answers: Record<string, boolean | string>, depth: number): void => {
    if (out.length >= MAX_PATHS_PER_PATHWAY) {
      truncated = true;
      return;
    }
    const node = p.nodes[nodeKey];
    if (!node || node.type === "outcome" || depth >= MAX_DEPTH) {
      out.push(answers);
      return;
    }
    if (node.kind === "boolean") {
      walk(node.onYes, { ...answers, [node.key]: true }, depth + 1);
      walk(node.onNo, { ...answers, [node.key]: false }, depth + 1);
    } else {
      for (const o of node.options) walk(o.next, { ...answers, [node.key]: o.value }, depth + 1);
    }
  };
  walk(p.startNodeKey, {}, 0);
  return { paths: out, truncated };
}

export function buildProbes(a: PresentingComplaintProtocol, b: PresentingComplaintProtocol): { probes: Probe[]; truncated: boolean } {
  const probes: Probe[] = [];
  let truncated = false;
  probes.push({ id: `${a.key}:clean`, pathway: a.key, kind: "clean_start", label: "No red flag, no answers yet", capture: cleanCapture(a.key), answers: {} });
  const seenRules = new Set<string>();
  for (const r of [...a.redFlagScreen, ...b.redFlagScreen]) {
    if (seenRules.has(r.key)) continue;
    seenRules.add(r.key);
    probes.push({ id: `${a.key}:rule:${r.key}`, pathway: a.key, kind: "red_flag_rule", label: `Red flag: ${r.label}`, capture: captureForRule(a.key, r), answers: {} });
  }
  const seenPaths = new Set<string>();
  for (const src of [a, b]) {
    const { paths, truncated: t } = enumeratePaths(src);
    truncated = truncated || t;
    for (const answers of paths) {
      const sig = JSON.stringify(Object.entries(answers));
      if (seenPaths.has(sig)) continue;
      seenPaths.add(sig);
      const text = Object.entries(answers).map(([k, v]) => `${k}=${String(v)}`).join(", ") || "no answers";
      probes.push({ id: `${a.key}:path:${sig}`, pathway: a.key, kind: "answer_path", label: `Answers: ${text}`, capture: cleanCapture(a.key), answers });
    }
  }
  return { probes, truncated };
}

function outcomeOf(p: PresentingComplaintProtocol, probe: Probe): ProbeOutcome {
  const r = runTriage(p, probe.capture, probe.answers);
  if (r.nextQuestion) return { category: "incomplete", firedRedFlags: r.redFlagScreen.fired.map((f) => f.key) };
  return { category: r.category, firedRedFlags: r.redFlagScreen.fired.map((f) => f.key) };
}

const looser = (before: ProbeOutcome, after: ProbeOutcome): boolean => {
  if (before.category === "incomplete") return false;
  if (after.category === "incomplete") return true;
  return !categoryAtLeast(after.category, before.category);
};

export function runRegression(from: TriageProtocolConfig, to: TriageProtocolConfig): RegressionReport {
  const fa = new Map(from.pathways.map((p) => [p.key, p]));
  const fb = new Map(to.pathways.map((p) => [p.key, p]));
  const changed: ChangedProbe[] = [];
  let probesRun = 0;
  let truncated = false;
  for (const [k, pa] of fa) {
    const pb = fb.get(k);
    if (!pb) continue;
    const built = buildProbes(pa, pb);
    truncated = truncated || built.truncated;
    for (const probe of built.probes) {
      probesRun += 1;
      const before = outcomeOf(pa, probe);
      const after = outcomeOf(pb, probe);
      if (before.category !== after.category || before.firedRedFlags.join() !== after.firedRedFlags.join()) {
        changed.push({ probe, before, after, loosened: looser(before, after) });
      }
    }
  }
  return {
    fromVersion: from.version,
    toVersion: to.version,
    probesRun,
    changed,
    loosened: changed.filter((c) => c.loosened),
    notReplayed: [...[...fa.keys()].filter((k) => !fb.has(k)), ...[...fb.keys()].filter((k) => !fa.has(k))],
    bundledFloorDrift: bundledFloorDrift(to.pathways),
    truncated,
  };
}
