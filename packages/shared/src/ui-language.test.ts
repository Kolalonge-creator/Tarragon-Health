import { asUiLanguage, DEFAULT_UI_LANGUAGE, hasPidgin, t } from "./ui-language";

describe("ui language", () => {
  it("defaults to English, including for junk and nulls", () => {
    expect(DEFAULT_UI_LANGUAGE).toBe("en");
    expect(asUiLanguage(null)).toBe("en");
    expect(asUiLanguage(undefined)).toBe("en");
    expect(asUiLanguage("yo")).toBe("en");
    expect(asUiLanguage("pcm")).toBe("pcm");
  });

  it("returns English untouched when English is selected", () => {
    expect(t("Medications", "en")).toBe("Medications");
  });

  it("translates the everyday navigation", () => {
    expect(t("Medications", "pcm")).toBe("Your medicine");
    expect(t("Labs & results", "pcm")).toBe("Test results");
  });

  it("degrades an untranslated string to readable English, never a key", () => {
    // A nav item added by somebody who never read the dictionary must render
    // as English, not as a broken label.
    expect(t("Some Brand New Section", "pcm")).toBe("Some Brand New Section");
  });

  it("carries no clinical, emergency, dosing or consent string", () => {
    // The boundary in ui-language.ts is the point of the whole file: a
    // half-translated safety instruction is worse than an untranslated one,
    // because the patient cannot tell which half they are reading. This test
    // is what stops that boundary eroding one well-meaning string at a time.
    const forbidden = [
      "Feeling something serious right now?",
      "Get emergency guidance",
      "A low is below",
      "Go to the nearest hospital now",
      "Crisis range",
      "mg/dL",
      "mmol/L",
    ];
    for (const phrase of forbidden) {
      expect(t(phrase, "pcm")).toBe(phrase);
    }
  });

  it("covers the five native lifestyle tracker screens (sleep/alcohol/smoking/movement/meals)", () => {
    // apps/mobile/src/screens/sections/tracker-screens.tsx calls t() on each
    // of these at the config call site. There is no programmatic way to
    // enumerate them the way navigation-pidgin-coverage.test.ts walks
    // getNavSections(), so this is the tripwire kept in sync by hand -- if a
    // tracker screen's question/blurb/button text changes there, it must
    // change here too, or it silently degrades to English.
    const stringsUsed = [
      "Sleep",
      "Log how you slept. Over a few weeks this shows a pattern you and your care team can see.",
      "How long did you sleep?",
      "How was it, 1 to 5?",
      "How sleepy were you in the day, 1 to 5?",
      "Save tonight's sleep",
      "Nothing logged yet. Tonight is a good place to start.",
      "Alcohol",
      "Keep a simple count of what you drink. No judgement, just the number.",
      "How many drinks today?",
      "Anything worth noting?",
      "Save today",
      "Nothing logged yet.",
      "Smoking",
      "Check in on how the day went. Cravings count too, even on a day you did not smoke.",
      "How many cigarettes today?",
      "How strong were the cravings, 1 to 5?",
      "Movement",
      "Anything counts: a walk, housework, football. Write what you did and for how long.",
      "What did you do?",
      "For how many minutes?",
      "Save it",
      "Meals",
      "Write down what you ate. Over time it helps you and your care team see what is working. To add a photo and get a carb estimate, open Meals on the website.",
      "Which meal?",
      "What did you eat?",
      "Save this meal",
      "Nothing logged yet. Your next meal is a fine place to start.",
      "Last 30 days",
      "Saved.",
    ];
    const missing = stringsUsed.filter((s) => !hasPidgin(s));
    expect(missing).toEqual([]);
  });
});
