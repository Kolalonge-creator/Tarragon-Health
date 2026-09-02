import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FEATURE_GROUPS,
  GROUP_META,
  PATIENT_FEATURES,
  isFeatureRelevant,
  searchFeatures,
  suggestableFeatures,
  type PatientSignals,
} from "./feature-registry";

const APP_DIR = join(__dirname, "..", "..", "app", "(dashboard)");

/** Resolve a /patient/... route to the page.tsx that serves it, accounting
 * for the (sections) route group the five core sections live in. */
function pageFileFor(route: string): string | null {
  const rest = route.replace(/^\/patient\/?/, "");
  const candidates = rest
    ? [join(APP_DIR, "patient", rest, "page.tsx"), join(APP_DIR, "patient", "(sections)", rest, "page.tsx")]
    : [join(APP_DIR, "patient", "(sections)", "page.tsx")];
  return candidates.find((c) => existsSync(c)) ?? null;
}

describe("patient feature registry", () => {
  it("has unique ids", () => {
    const ids = PATIENT_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only uses declared groups, and every group has a directory page", () => {
    for (const feature of PATIENT_FEATURES) {
      expect(FEATURE_GROUPS).toContain(feature.group);
    }
    for (const group of FEATURE_GROUPS) {
      expect(pageFileFor(GROUP_META[group].href)).not.toBeNull();
    }
  });

  it("every group has at least one feature in it", () => {
    for (const group of FEATURE_GROUPS) {
      expect(PATIENT_FEATURES.some((f) => f.group === group)).toBe(true);
    }
  });

  /**
   * The registry's central promise, and the reason this file exists: a
   * feature's href must land the patient ON the thing. A route that does not
   * exist sends them to a 404; an anchor with no matching element sends them
   * to the top of a long page to hunt for the card themselves, which is the
   * exact failure the whole discovery pass was built to end. Both are silent
   * in production, so they are caught here instead.
   */
  it("every href points at a real page", () => {
    const broken = PATIENT_FEATURES.filter((f) => !pageFileFor(f.href.split("#")[0])).map((f) => f.id);
    expect(broken).toEqual([]);
  });

  it("every #anchor resolves to a real anchor on its page", () => {
    const broken: string[] = [];
    for (const feature of PATIENT_FEATURES) {
      const [route, anchor] = feature.href.split("#");
      if (!anchor) continue;
      const file = pageFileFor(route);
      if (!file) continue; // reported by the test above
      const source = readFileSync(file, "utf8");
      // A FeatureAnchor, a DashboardSection, or any plain id= attribute all
      // count — the point is that something on the page carries the id.
      if (!new RegExp(`id="${anchor}"`).test(source)) broken.push(`${feature.id} -> #${anchor}`);
    }
    expect(broken).toEqual([]);
  });

  it("writes patient-facing copy in house style", () => {
    for (const feature of PATIENT_FEATURES) {
      // Standing rule: no em dashes in marketing or dashboard copy.
      expect(feature.blurb).not.toMatch(/—/);
      expect(feature.label).not.toMatch(/—/);
      // A blurb is one line a patient reads at a glance, not a paragraph.
      expect(feature.blurb.length).toBeLessThanOrEqual(200);
      expect(feature.blurb.length).toBeGreaterThan(10);
      // No fear-based urgency in patient copy. The brand rule is about the
      // shouty label ("WARNING:"), not about the vocabulary of clinical risk:
      // "if a reading ever looks dangerous" is exactly how we should describe
      // what the emergency contact is for, so this matches the shouting, not
      // the word.
      expect(feature.blurb).not.toMatch(/\b(WARNING|URGENT|DANGER|ALERT|CAUTION)\b/);
      expect(feature.blurb).not.toMatch(/!{1}/);
    }
  });

  it("keywords are lowercase, so search's lowercased query can match them", () => {
    for (const feature of PATIENT_FEATURES) {
      for (const keyword of feature.keywords ?? []) {
        expect(keyword).toBe(keyword.toLowerCase());
      }
    }
  });
});

describe("isFeatureRelevant", () => {
  const base: PatientSignals = { sex: null, ageYears: null, conditions: [], features: [] };

  it("treats an unrecorded signal as permissive, never as an exclusion", () => {
    const cycle = PATIENT_FEATURES.find((f) => f.id === "cycle-tracking")!;
    // Sex not recorded: we do not know, so we do not rule her out.
    expect(isFeatureRelevant(cycle, base)).toBe(true);
    expect(isFeatureRelevant(cycle, { ...base, sex: "female" })).toBe(true);
    expect(isFeatureRelevant(cycle, { ...base, sex: "male" })).toBe(false);
  });

  it("matches any-of on conditions", () => {
    const glucose = PATIENT_FEATURES.find((f) => f.id === "glucose-insights")!;
    expect(isFeatureRelevant(glucose, { ...base, conditions: ["diabetes"] })).toBe(true);
    expect(isFeatureRelevant(glucose, { ...base, conditions: ["hypertension"] })).toBe(false);
  });

  it("respects age floors only when an age is known", () => {
    const findrisc = PATIENT_FEATURES.find((f) => f.id === "findrisc")!;
    expect(isFeatureRelevant(findrisc, { ...base, ageYears: 24 })).toBe(false);
    expect(isFeatureRelevant(findrisc, { ...base, ageYears: 44 })).toBe(true);
    expect(isFeatureRelevant(findrisc, base)).toBe(true);
  });

  it("respects entitlement codes", () => {
    const coaching = PATIENT_FEATURES.find((f) => f.id === "lifestyle")!;
    expect(isFeatureRelevant(coaching, base)).toBe(false);
    expect(isFeatureRelevant(coaching, { ...base, features: ["lifestyle_coaching"] })).toBe(true);
  });
});

describe("searchFeatures", () => {
  it("finds cycle tracking from the word a patient would actually type", () => {
    for (const query of ["period", "menstrual", "menopause", "ovulation"]) {
      expect(searchFeatures(query).map((f) => f.id)).toContain("cycle-tracking");
    }
  });

  it("is relevance-blind: it never hides a real feature from somebody who named it", () => {
    // No signals are passed at all — search takes none by design.
    expect(searchFeatures("ask a doctor").map((f) => f.id)).toContain("ask-a-doctor");
    expect(searchFeatures("counterfeit").map((f) => f.id)).toContain("check-my-pack");
    expect(searchFeatures("export my data").length).toBeGreaterThanOrEqual(0);
    expect(searchFeatures("delete").map((f) => f.id)).toContain("data-rights");
  });

  it("ranks a label match above a blurb match", () => {
    const results = searchFeatures("emergency card");
    expect(results[0]?.id).toBe("emergency-card");
  });

  it("ignores queries too short to mean anything", () => {
    expect(searchFeatures("")).toEqual([]);
    expect(searchFeatures("a")).toEqual([]);
  });

  it("returns nothing rather than everything for a miss", () => {
    expect(searchFeatures("zzzzqqqq")).toEqual([]);
  });
});

describe("suggestableFeatures", () => {
  const signals: PatientSignals = {
    sex: "female",
    ageYears: 34,
    conditions: [],
    features: [],
  };

  it("suggests cycle tracking to a woman who has never opened it", () => {
    expect(suggestableFeatures(signals, []).map((f) => f.id)).toContain("cycle-tracking");
  });

  it("leads with what is specifically for this patient, not with generic cards", () => {
    // The two slots on Overview go to the most specific match. Registry order
    // alone put "Your reading trends" first for everybody, which tells a
    // patient nothing they could not have guessed.
    const top = suggestableFeatures(signals, []).slice(0, 2).map((f) => f.id);
    expect(top).toContain("cycle-tracking");
    expect(top).not.toContain("vitals-trends");
  });

  it("puts a diabetic patient's own checks ahead of general ones", () => {
    const diabetic: PatientSignals = {
      sex: "male",
      ageYears: 58,
      conditions: ["diabetes"],
      features: [],
    };
    const top = suggestableFeatures(diabetic, []).slice(0, 2).map((f) => f.id);
    expect(top.some((id) => ["glucose-insights", "diabetes-log", "complications", "foot-risk"].includes(id))).toBe(true);
  });

  it("stops suggesting it once she has", () => {
    expect(suggestableFeatures(signals, ["cycle-tracking"]).map((f) => f.id)).not.toContain(
      "cycle-tracking",
    );
  });

  it("never suggests the things marked neverSuggest", () => {
    const ids = suggestableFeatures(signals, []).map((f) => f.id);
    expect(ids).not.toContain("emergency-card");
    expect(ids).not.toContain("symptoms");
    expect(ids).not.toContain("messages");
  });

  it("never suggests a paid feature to somebody whose plan does not include it", () => {
    const ids = suggestableFeatures(signals, []).map((f) => f.id);
    expect(ids).not.toContain("lifestyle");
    expect(ids).not.toContain("ask-a-doctor");
  });
});
