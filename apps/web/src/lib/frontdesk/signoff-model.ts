/**
 * Pure model for the admin sign-off hub (Front Desk). No I/O. The page reads rows and this decides what is waiting, so the banner on the
 * admin home and the hub page can never count differently.
 */

export interface StepRow {
  readonly id: string;
  readonly sequenceKey: string;
  readonly sequenceName: string;
  readonly sequencePurpose: "service_followup" | "marketing";
  readonly position: number;
  readonly delayMinutes: number;
  readonly stepKey: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly status: "draft" | "approved";
  readonly approvedAt: string | null;
}

export interface KnowledgeRow {
  readonly id: string;
  readonly topic: string;
  readonly version: number;
  readonly content: string;
  readonly active: boolean;
  readonly approvedAt: string | null;
}

/** Steps nobody has approved yet, in sequence then step order. */
export function pendingSteps(rows: readonly StepRow[]): StepRow[] {
  return rows
    .filter((r) => r.status === "draft")
    .sort((a, b) => a.sequenceKey.localeCompare(b.sequenceKey) || a.position - b.position);
}

/**
 * The knowledge entries waiting for approval: for each topic, the NEWEST version, if it is not approved. An old unapproved version that a
 * newer one has superseded is not waiting on anyone, and a topic whose newest version is the active one is settled.
 */
export function pendingKnowledge(rows: readonly KnowledgeRow[]): KnowledgeRow[] {
  const newest = new Map<string, KnowledgeRow>();
  for (const r of rows) {
    const cur = newest.get(r.topic);
    if (!cur || r.version > cur.version) newest.set(r.topic, r);
  }
  return [...newest.values()].filter((r) => !r.active && r.approvedAt === null).sort((a, b) => a.topic.localeCompare(b.topic));
}

/** "straight away", "after 1 hour", "after 2 days": how long after the trigger a step is sent. */
export function describeDelay(minutes: number): string {
  if (minutes <= 0) return "straight away";
  if (minutes < 60) return `after ${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes < 60 * 24) {
    const h = Math.round(minutes / 60);
    return `after ${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(minutes / (60 * 24));
  return `after ${d} day${d === 1 ? "" : "s"}`;
}

/** What a reader sees in place of the placeholders, so they approve the email as the recipient will meet it. */
export function previewStepText(text: string): string {
  return text.replace(/\{\{first_name\}\}/g, "Ada").replace(/\{\{link\}\}/g, "https://app.tarragonhealth.ng/…");
}

export interface FrontDeskSignoff {
  readonly steps: StepRow[];
  readonly knowledge: KnowledgeRow[];
  readonly pendingStepCount: number;
  readonly pendingKnowledgeCount: number;
  /** What the banner shows. */
  readonly attentionCount: number;
  /** A read failed, so the counts understate reality. Never render this as an all-clear. */
  readonly failed: boolean;
}

export function frontDeskSignoff(steps: readonly StepRow[], knowledge: readonly KnowledgeRow[], failed: boolean): FrontDeskSignoff {
  const ps = pendingSteps(steps);
  const pk = pendingKnowledge(knowledge);
  return {
    steps: [...steps],
    knowledge: [...knowledge],
    pendingStepCount: ps.length,
    pendingKnowledgeCount: pk.length,
    attentionCount: ps.length + pk.length,
    failed,
  };
}

/**
 * A fingerprint of the exact wording a reader was shown. An approval carries it, and the server refuses when the stored wording no longer
 * matches, so "Approve all" can never approve text that was edited after the page was loaded. FNV-1a over the UTF-16 units: not a security
 * hash, only a change detector for two short strings, and it needs no Node crypto so the page and the action share one definition.
 */
export function textFingerprint(...parts: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0xff; // part separator, so ("ab","c") and ("a","bc") differ
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const stepFingerprint = (r: Pick<StepRow, "subject" | "bodyText">): string => textFingerprint(r.subject, r.bodyText);
export const knowledgeFingerprint = (r: Pick<KnowledgeRow, "content" | "version">): string => textFingerprint(String(r.version), r.content);
