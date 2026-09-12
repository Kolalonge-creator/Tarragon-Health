import { hasPidgin } from "@tarragon/shared";
import { getNavSections } from "./navigation";

/**
 * The dictionary in packages/shared/src/ui-language.ts is keyed by the exact
 * English source string. That is what makes it cheap — navigation.ts needs no
 * translation keys — but it means renaming an English label silently drops its
 * Pidgin, leaving one row in English next to fifteen translated ones.
 *
 * This test is the tripwire for that. If it fails, either add the new English
 * string to PIDGIN or, if it genuinely should not be translated, add it to the
 * exclusions below with a reason.
 */
const NOT_TRANSLATED: ReadonlySet<string> = new Set([
  // Proper nouns and clinical terms that read the same either way, or where a
  // Pidgin rendering would be a guess rather than a translation.
]);

function patientLabels(): string[] {
  const labels: string[] = [];
  for (const receivesCare of [true, false]) {
    for (const section of getNavSections("patient", receivesCare)) {
      if (section.label) labels.push(section.label);
      for (const item of section.items) {
        labels.push(item.label);
        if (item.shortLabel) labels.push(item.shortLabel);
      }
    }
  }
  return [...new Set(labels)];
}

describe("Pidgin covers the patient navigation", () => {
  it("has an entry for every patient nav label and short label", () => {
    const missing = patientLabels().filter(
      (label) => !hasPidgin(label) && !NOT_TRANSLATED.has(label)
    );
    expect(missing).toEqual([]);
  });

  it("is actually checking something", () => {
    // Guards against the assertion above passing because patientLabels()
    // silently returned nothing.
    expect(patientLabels().length).toBeGreaterThan(25);
  });
});
