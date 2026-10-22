/**
 * UI-B (change 6): words that must never appear in a notification title, push text, email subject or lock-screen text because they name
 * a cycle, pregnancy or contraception topic. The main INV-07 list (supabase/functions/_shared/notifications/neutral.ts) already holds
 * pregnan*, contracept*, cycle*, period, fertil*, ovulat*, menstru*, menopaus* and more, and that list is mirrored in the database
 * (`notification_forbidden_terms`), so it cannot grow without a migration. This is the extra, code-only list the new test applies on top
 * of it, covering the words a phone screen would still give away. Whole words or stems (a trailing * is any ending). Lower case.
 */
export const REPRODUCTIVE_TOPIC_EXTRA_TERMS: readonly string[] = [
  "trimester*", "birth control", "morning after", "morning-after", "baby", "babies", "expecting", "due date", "labour", "labor",
  "postpartum", "miscarriage*", "ivf", "iud", "implant", "condom*", "breastfe*", "newborn*", "gestation*", "womb", "uterus",
  "growth", "growth chart*", "muac",
];

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns: readonly RegExp[] = REPRODUCTIVE_TOPIC_EXTRA_TERMS.map((t) => {
  const stem = t.endsWith("*");
  const body = escapeRegex(stem ? t.slice(0, -1) : t).replace(/\\? /g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])(${body}${stem ? "[a-z]*" : ""})(?![a-z0-9])`, "i");
});

/** The extra reproductive-topic words found in a piece of notification text (empty when it is neutral). */
export function reproductiveTopicWords(text: string): string[] {
  const bare = text.replace(/\{\{\s*\w+\s*\}\}/g, " ");
  const out: string[] = [];
  for (const re of patterns) {
    const m = re.exec(bare);
    if (m) out.push((m[2] as string).toLowerCase());
  }
  return out;
}
