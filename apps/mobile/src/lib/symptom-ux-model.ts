import { isSelfHarmScreen, screenAssistantMessage } from "@tarragon/clinical";
import { t, type MessageKey } from "@tarragon/i18n";
import {
  DESCRIBE_DRAFT,
  EXPLAINER_DRAFT,
  SAFETY_NET_DRAFT,
  buildResultExtras,
  describeEntry,
  describeTableSchema,
  explainerConfigSchema,
  parseInForce,
  resolveBundled,
  safetyNetConfigSchema,
  type AnsweredQuestion,
  type DescribeOutcome,
  type DescribeTable,
  type ExplainerConfig,
  type ResultExtras,
  type SafetyNetConfig,
  type SymptomCapture,
  type Translate,
  type TriageCategory,
} from "@tarragon/symptom-triage-engine";

/**
 * S59c on the phone: the pure decisions behind "describe it", "Why this result", the safety net and the save-this-card text. No network,
 * no storage, no model (INV-01). The screens only render what these return.
 *
 * WHICH CONFIGS ARE IN FORCE. Every config ships as an unsigned draft, which is inert. When the server answered, it sends the configs it has
 * already checked against the live signed version (`state.ux`): the phone uses exactly those, re-validated here, and never falls back to its
 * own bundled copy for a field the server sent as null (a null means "not signed, or the bundle has drifted"). Only when the server sent
 * no `ux` at all (an older server, or a state read before this feature) is the bundled copy judged on its own, the way it is when offline.
 */
export const tr: Translate = (key, params) => t(key as MessageKey, "en", params);

export interface MobileUx {
  describe: DescribeTable | null;
  explainer: ExplainerConfig | null;
  safetyNet: SafetyNetConfig | null;
}

export const NO_UX: MobileUx = { describe: null, explainer: null, safetyNet: null };

/** The bundled copy judged on its own (offline, or no `ux` from the server): in force only when signed. */
export function bundledUx(): MobileUx {
  return {
    describe: resolveBundled(describeTableSchema, DESCRIBE_DRAFT).config,
    explainer: resolveBundled(explainerConfigSchema, EXPLAINER_DRAFT).config,
    safetyNet: resolveBundled(safetyNetConfigSchema, SAFETY_NET_DRAFT).config,
  };
}

export function uxFromState(state: { ux?: unknown } | null | undefined): MobileUx {
  const u = state?.ux;
  if (!u || typeof u !== "object") return bundledUx();
  const o = u as Record<string, unknown>;
  return {
    describe: parseInForce(describeTableSchema, o.describe),
    explainer: parseInForce(explainerConfigSchema, o.explainer),
    safetyNet: parseInForce(safetyNetConfigSchema, o.safetyNet),
  };
}

/** The danger-phrase screen first, on this phone, then the synonym table. The typed text is only ever an argument; nothing returned contains it. */
export function describeOnDevice(text: string, ux: MobileUx, availableKeys: readonly string[]): DescribeOutcome {
  return describeEntry(text, {
    dangerScreen: (s) => {
      const screen = screenAssistantMessage(s);
      return { redFlag: screen.redFlag, selfHarm: isSelfHarmScreen(screen) };
    },
    table: ux.describe,
    available: availableKeys,
  });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "22 October 2026" in Africa/Lagos (UTC+1, no daylight saving), without relying on Intl being present on the device. */
export function lagosDateLabel(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms + 60 * 60 * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface PhoneResult {
  category: TriageCategory;
  complaintKey: string;
  complaintLabel: string | null;
  headline: string;
  nextStep: string | null;
  checkedAt: string;
  capture: SymptomCapture | null;
  firedRuleKeys: readonly string[];
  safetyNetMessageKey: string;
  tightenedBy: readonly string[];
  questionsAsked: readonly AnsweredQuestion[];
  /** The pathway is exactly the bundled copy, or the result came from the on-device floor. */
  bundledPathway: boolean;
}

export function phoneExtras(r: PhoneResult, ux: MobileUx): ResultExtras {
  return buildResultExtras(
    {
      category: r.category,
      complaintKey: r.complaintKey,
      complaintLabel: r.complaintLabel,
      headline: r.headline,
      nextStep: r.nextStep,
      dateLabel: lagosDateLabel(r.checkedAt),
      capture: r.capture,
      firedRuleKeys: r.firedRuleKeys,
      safetyNetMessageKey: r.safetyNetMessageKey,
      tightenedBy: r.tightenedBy,
      questionsAsked: r.questionsAsked,
      useBundledConditions: r.bundledPathway,
    },
    { explainer: ux.explainer, safetyNet: ux.safetyNet },
    tr,
  );
}

/** A random key for one open describe screen. It only makes the "danger wording found" event once-only; it carries nothing about the person. */
export function newDescribeSessionKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
