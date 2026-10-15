import { createHash } from "node:crypto";

/**
 * Reviewed-strings ledger (CMO decision S-15): unreviewed clinical copy blocks the release build.
 *
 * Every string in the clinical, emergency and consent namespaces has an entry in `reviewed-strings-ledger.json` with the
 * hash of the text, who reviewed it and when. The check (`reviewed-ledger.test.ts`) fails when a string in those
 * namespaces is added or changed without a matching entry. Strings that existed when the ledger was seeded carry the
 * reviewer "unreviewed (baseline)": that is an honest record that nobody has recorded a review, NOT an approval. The
 * baseline can only shrink (a real reviewer name replaces it); it can never grow.
 */
export const BASELINE_REVIEWER = "unreviewed (baseline)";

export interface LedgerEntry {
  readonly hash: string;
  readonly reviewer: string;
  /** ISO date YYYY-MM-DD the review was recorded; null for baseline entries. */
  readonly reviewedOn: string | null;
  /** True only for entries seeded when the ledger was created. */
  readonly baseline: boolean;
}

export interface Ledger {
  readonly namespaces: Readonly<Record<"clinical" | "emergency" | "consent", readonly string[]>>;
  /** Number of baseline entries when seeded. The count of baseline entries may fall but never exceed this. */
  readonly baselineCeiling: number;
  readonly entries: Readonly<Record<string, LedgerEntry>>;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

export function inScope(key: string, ledger: Pick<Ledger, "namespaces">): boolean {
  const prefix = key.split(".")[0] ?? "";
  return Object.values(ledger.namespaces).some((list) => list.includes(prefix));
}

export interface LedgerReport {
  readonly missing: string[];
  readonly changed: string[];
  readonly badEntries: string[];
  readonly staleEntries: string[];
  readonly baselineCount: number;
  readonly reviewedCount: number;
  readonly scopeCount: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Compare the strings in scope against the ledger. `strings` maps key to current text. */
export function checkLedger(strings: Readonly<Record<string, string>>, ledger: Ledger): LedgerReport {
  const missing: string[] = [];
  const changed: string[] = [];
  const badEntries: string[] = [];
  let baselineCount = 0;
  let reviewedCount = 0;
  const scope = Object.keys(strings).filter((k) => k.startsWith("wording:") || inScope(k, ledger));
  for (const key of scope) {
    const entry = ledger.entries[key];
    if (!entry) {
      missing.push(key);
      continue;
    }
    if (entry.hash !== hashText(strings[key] as string)) changed.push(key);
    if (entry.baseline) {
      baselineCount += 1;
      if (entry.reviewer !== BASELINE_REVIEWER || entry.reviewedOn !== null) badEntries.push(`${key}: baseline entry must keep the baseline reviewer and no date`);
    } else {
      reviewedCount += 1;
      if (entry.reviewer.trim().length === 0 || /^unreviewed/i.test(entry.reviewer.trim())) badEntries.push(`${key}: a reviewed entry needs a real reviewer name`);
      if (!entry.reviewedOn || !ISO_DATE.test(entry.reviewedOn)) badEntries.push(`${key}: a reviewed entry needs a review date (YYYY-MM-DD)`);
    }
  }
  const staleEntries = Object.keys(ledger.entries).filter((k) => !scope.includes(k));
  return { missing, changed, badEntries, staleEntries, baselineCount, reviewedCount, scopeCount: scope.length };
}
