export type LegalSection = { heading: string; paragraphs: string[] };

/**
 * Parses a consent_versions.body string into headed sections for rendering.
 * Same "## Heading" / blank-line-separated-paragraph convention as
 * marketing-resources.ts's parseSectionsFromText, duplicated (not imported)
 * because this file is shared by both the dashboard (onboarding consent
 * step) and the marketing tree (public legal pages), and marketing pages
 * must not import platform/dashboard modules.
 */
export function parseLegalSections(body: string): LegalSection[] {
  const sections: LegalSection[] = [];
  let current: LegalSection | null = null;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), paragraphs: [] };
    } else if (line.trim() === "") {
      if (current && current.paragraphs[current.paragraphs.length - 1] !== "")
        current.paragraphs.push("");
    } else if (current) {
      const last = current.paragraphs.length - 1;
      if (last >= 0 && current.paragraphs[last] !== "") {
        current.paragraphs[last] = `${current.paragraphs[last]} ${line.trim()}`;
      } else {
        if (current.paragraphs[last] === "") current.paragraphs.pop();
        current.paragraphs.push(line.trim());
      }
    }
  }
  if (current) sections.push(current);
  return sections
    .map((s) => ({ ...s, paragraphs: s.paragraphs.filter((p) => p.trim() !== "") }))
    .filter((s) => s.heading && s.paragraphs.length > 0);
}
