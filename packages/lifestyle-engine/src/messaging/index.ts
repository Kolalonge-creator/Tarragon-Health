/**
 * Messaging — the outbound gateway interface + toneGuard (spec §10).
 *
 * The engine NEVER owns WhatsApp Cloud API plumbing; it calls a MessagingGateway
 * (implemented in apps/web over the existing notifications queue). WhatsApp is
 * outbound alerts/comms only — never a logging surface.
 */
export * from "./inbound";

export const MESSAGE_CLASSES = [
  "reminder",
  "coaching_nudge",
  "result",
  "escalation",
  "reengagement",
  "admin",
] as const;
export type MessageClass = (typeof MESSAGE_CLASSES)[number];

export interface OutboundMessage {
  patientId: string;
  templateKey: string;
  messageClass: MessageClass;
  /** Template variables — never raw clinical verdicts. */
  variables?: Record<string, string>;
}

/** Injected side-effect boundary. The engine core depends only on this. */
export interface MessagingGateway {
  send(message: OutboundMessage): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// toneGuard (spec §10.3 / §18.6, §18.9) — deny-list for MVP.
// ---------------------------------------------------------------------------

/** Words/phrases that must never appear in patient-facing copy. */
const DENY_TERMS: readonly string[] = [
  "obese",
  "obesity", // in patient-facing copy; catalogue/clinical labels are separate
  "fat",
  "overweight",
  "failure",
  "failed",
  "cheat",
  "cheating",
  "lazy",
  "willpower",
  "shame",
];

/** Clinical-reassurance phrases a bot must never emit (spec §9.4, §18.6). */
const DENY_REASSURANCE: readonly RegExp[] = [
  /\byour (bp|blood pressure|sugar|glucose|weight) (is|are|looks?) (fine|normal|controlled|good|okay|ok)\b/i,
  /\bnothing to worry about\b/i,
  /\byou'?re (fine|healthy|all good)\b/i,
];

export interface ToneCheck {
  ok: boolean;
  violations: string[];
}

/**
 * Check a rendered patient-facing string. Runs in CI (template library) and at
 * send time. Person-first, health-focused; no shame/blame, no clinical verdict.
 */
export function toneGuard(text: string): ToneCheck {
  const lower = text.toLowerCase();
  const violations: string[] = [];

  for (const term of DENY_TERMS) {
    // Word-boundary match so "prefatory" doesn't trip "fat".
    const re = new RegExp(`\\b${term}\\b`, "i");
    if (re.test(lower)) violations.push(`deny_term:${term}`);
  }
  for (const re of DENY_REASSURANCE) {
    if (re.test(text)) violations.push(`reassurance:${re.source}`);
  }

  return { ok: violations.length === 0, violations };
}
