/** @jest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { OUTPUT_KINDS, OUTPUT_KIND_KEYS, t } from "@tarragon/i18n";
import { OutputKindLabel } from "./output-kind-label";

describe("OutputKindLabel", () => {
  it.each(OUTPUT_KINDS.map((k) => [k]))("%s shows its words, its explanation for screen readers, and its kind", (kind) => {
    const html = renderToStaticMarkup(<OutputKindLabel kind={kind} />);
    expect(html).toContain(t(OUTPUT_KIND_KEYS[kind].label, "en"));
    expect(html).toContain(t(OUTPUT_KIND_KEYS[kind].hint, "en"));
    expect(html).toContain(`data-output-kind="${kind}"`);
    expect(html).toContain("sr-only");
  });

  it("a staff screen gets the staff explanation, never 'your record'", () => {
    const html = renderToStaticMarkup(<OutputKindLabel kind="automated_information" audience="staff" />);
    // The apostrophe is escaped in markup, so check the part of the sentence that has none.
    expect(html).toContain("No clinician has checked it, and it is not a diagnosis.");
    expect(html).not.toContain("your record");
    expect(html).not.toContain("your care team");
    const patient = renderToStaticMarkup(<OutputKindLabel kind="automated_information" />);
    expect(patient).toContain(t("output.kind.automated.hint", "en"));
  });

  it("keeps a screen's own caveat beside the label instead of replacing it", () => {
    const html = renderToStaticMarkup(<OutputKindLabel kind="automated_information" note="not yet filed" />);
    expect(html).toContain("Automated information");
    expect(html).toContain("not yet filed");
  });

  it("the three kinds read differently, so colour is never the only difference", () => {
    const words = OUTPUT_KINDS.map((k) => renderToStaticMarkup(<OutputKindLabel kind={k} />).match(/<span>([^<]+)<\/span>/)?.[1]);
    expect(new Set(words).size).toBe(3);
  });
});
