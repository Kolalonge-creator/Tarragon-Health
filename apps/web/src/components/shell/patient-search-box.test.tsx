/** @jest-environment node */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { PatientSearchBox } from "./patient-search-box";

describe("PatientSearchBox", () => {
  const html = renderToStaticMarkup(<PatientSearchBox />);
  it("is a plain GET form to the patient directory with a labelled field", () => {
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/clinician/patients"');
    expect(html).toContain('name="q"');
    expect(html).toContain("Find a patient by name, Tarragon number or phone");
  });
  it("offers no browser or live suggestions", () => {
    expect(html).toContain('autoComplete="off"');
    expect(html).not.toContain("datalist");
  });
});
