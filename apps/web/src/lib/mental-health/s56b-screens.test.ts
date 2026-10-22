import { readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "@tarragon/i18n";
import { panicKeysUsed } from "@tarragon/shared";

/**
 * S56b source-level guarantees for the new patient screens: what each one is allowed to call, store and import. These fail the build if someone
 * later adds a network call, a log, a write or a journal read where it does not belong. (Behaviour is covered by calm-tool.a11y.test.tsx.)
 */
const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const readMobile = (p: string) => readFileSync(join(process.cwd(), "..", "mobile", "src", p), "utf8");
const rpcNames = (src: string) => [...src.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);

describe("the calm tool is offline, silent and always leaves a way out", () => {
  const src = read("components/mental-health/calm-tool.tsx");
  it("makes exactly one call of its own, the existing hand-off, started by the person", () => {
    expect(rpcNames(src)).toEqual(["request_mental_health_handoff"]);
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie|console\.|window\.gtag|track\(/);
  });
  it("embeds the existing crisis card and shows the way out whenever the help card is not already open", () => {
    expect(src).toContain('import { CrisisCard } from "@/components/mental-health/crisis-card"');
    expect(src).toMatch(/\{!help && \(\s*<div[^>]*>\s*<button[^>]*onClick=\{\(\) => setHelp\(true\)\}/);
  });
  it("is not behind the guard the exercise is behind: the crisis card is not imported through a flag", () => {
    expect(src).not.toMatch(/features\.|enabled &&[^;]*CrisisCard/);
  });
  it("every word it shows exists in the catalogue, and every panic.* string is used by it (or is a state message)", () => {
    const cat = en as Record<string, string>;
    for (const k of panicKeysUsed()) expect([k, k in cat]).toEqual([k, true]);
    const all = Object.keys(cat).filter((k) => k.startsWith("panic."));
    const both = `${src}\n${readMobile("components/wellbeing/calm-tool.tsx")}`;
    for (const k of all) expect([k, both.includes(`"${k}"`) || (both.includes("groundingKey") && k.startsWith("panic.ground_"))]).toEqual([k, true]);
  });
});

describe("the phone's calm tool follows the same rules", () => {
  const src = readMobile("components/wellbeing/calm-tool.tsx");
  it("makes exactly one call of its own, the existing hand-off, and writes nothing to the device", () => {
    expect(rpcNames(src)).toEqual(["request_mental_health_handoff"]);
    expect(src).not.toMatch(/\bfetch\(|AsyncStorage|SecureStore|console\.|Analytics|track\(/);
  });
  it("embeds the crisis card and shows the way out whenever the help card is not already open", () => {
    expect(src).toContain('import { CrisisCard } from "@/components/mental-health/crisis-card"');
    expect(src).toMatch(/\{!help && \(\s*<View[^>]*>\s*<BigButton title=\{tr\("panic\.danger"\)\}/);
  });
  it("the phone's share summary starts with nothing chosen and calls only the preview and the send", () => {
    const share = readMobile("components/wellbeing/share-summary-card.tsx");
    expect(share).toMatch(/useState<SummaryChoices>\(NOTHING_CHOSEN\)/);
    expect(rpcNames(share)).toEqual(["preview_wellbeing_summary", "share_wellbeing_summary_with_care_team"]);
    expect(share.toLowerCase()).not.toContain("journal");
  });
  it("the phone's patterns card computes on the phone, writes only the hide preference and has no push", () => {
    const card = readMobile("components/wellbeing/mood-patterns-card.tsx");
    expect(rpcNames(card)).toEqual(["set_mood_insights_hidden"]);
    expect(card).toContain("moodInsights(days");
    expect(card).not.toMatch(/Notifications|schedulePush|\.insert\(|\.upsert\(|fetch\(/);
  });
});

describe("the share summary can only send what the patient chose", () => {
  const src = read("components/mental-health/share-summary-card.tsx");
  it("starts with nothing chosen and calls only the preview and the send", () => {
    expect(src).toMatch(/useState<SummaryChoices>\(NOTHING_CHOSEN\)/);
    expect(rpcNames(src)).toEqual(["preview_wellbeing_summary", "share_wellbeing_summary_with_care_team"]);
  });
  it("never offers or mentions the journal as something to send", () => {
    expect(src.toLowerCase()).not.toContain("journal");
  });
  it("clears the preview whenever a choice changes, so what is previewed is what is sent", () => {
    expect(src).toMatch(/function change\([^)]*\)[\s\S]*setPreview\(null\)/);
  });
});

describe("the patterns view is private to the patient", () => {
  const view = read("components/mental-health/mood-patterns.tsx");
  const toggle = read("components/mental-health/mood-patterns-visibility.tsx");
  it("is a server component that reads and writes nothing itself and sends no raw data to the browser", () => {
    expect(view).not.toMatch(/^"use client"/);
    expect(view).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.from\(/);
    expect(view).toContain("fetchMoodTrendDays(");
  });
  it("its only write is the patient's own hide preference", () => {
    expect(rpcNames(toggle)).toEqual(["set_mood_insights_hidden"]);
  });
  it("is never handed to anyone but the person's own profile and never to a clinician screen", () => {
    expect(read("app/(dashboard)/patient/(sections)/wellbeing/page.tsx")).toContain("ownProfile && features.insights");
    expect(read("app/(dashboard)/clinician/patients/[patientId]/page.tsx")).not.toMatch(/mood-patterns|MoodPatterns/);
    expect(read("components/mental-health/shared-summaries.tsx")).not.toMatch(/mood-patterns|moodInsights/);
  });
  it("the data loader reads only the owner's own rows through the caller's session", () => {
    const loader = read("lib/queries/mood-trend-data.ts");
    expect(loader).not.toMatch(/createServiceRoleClient|service_role/);
    expect(loader).toContain('.eq("patient_id", patientId)');
  });
});
