/**
 * UI-B (change 6): words that must never appear in a notification title, push text, email subject or lock-screen text because they name
 * a cycle, pregnancy or contraception topic. The main INV-07 list (supabase/functions/_shared/notifications/neutral.ts) already holds
 * pregnan*, contracept*, cycle*, period, fertil*, ovulat*, menstru*, menopaus* and more. THIS list is separate and is enforced by tests
 * only: it is NOT in the database table `notification_forbidden_terms`, so the database does not check these words at send time (the
 * existing test requires the code and database lists to match, and no migration was written; see OQ-733). Whole words or stems (a
 * trailing * is any ending). Lower case. A whole word also matches its plural and common verb forms (s, es, ed, ing), so "IUDs",
 * "implants", "wombs" and "labouring" are caught without listing each one.
 */
export const REPRODUCTIVE_TOPIC_EXTRA_TERMS: readonly string[] = [
  "trimester*", "birth control", "morning after", "morning-after", "baby", "babies", "expecting", "expectant", "due date", "labour",
  "labor", "postpartum", "miscarriage*", "ivf", "iud", "implant", "condom", "breastfe*", "newborn*", "gestation*", "womb", "uterus",
  "growth", "growth chart", "muac",
];

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const reproductiveTopicPatterns: readonly RegExp[] = REPRODUCTIVE_TOPIC_EXTRA_TERMS.map((t) => {
  const stem = t.endsWith("*");
  const body = escapeRegex(stem ? t.slice(0, -1) : t).replace(/\\? /g, "\\s+");
  const ending = stem ? "[a-z]*" : "(?:s|es|ed|ing)?";
  return new RegExp(`(^|[^a-z0-9])(${body}${ending})(?![a-z0-9])`, "i");
});

/** The extra reproductive-topic words found in a piece of notification text (empty when it is neutral). */
export function reproductiveTopicWords(text: string): string[] {
  const bare = text.replace(/\{\{\s*\w+\s*\}\}/g, " ");
  const out: string[] = [];
  for (const re of reproductiveTopicPatterns) {
    const m = re.exec(bare);
    if (m) out.push((m[2] as string).toLowerCase());
  }
  return out;
}
