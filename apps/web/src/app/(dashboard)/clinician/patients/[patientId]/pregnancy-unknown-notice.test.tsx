import { renderToStaticMarkup } from "react-dom/server";
import { PregnancyUnknownNotice } from "./pregnancy-unknown-notice";

describe("PregnancyUnknownNotice", () => {
  it("says the status could not be read and tells the prescriber to check, as an alert", () => {
    const out = renderToStaticMarkup(<PregnancyUnknownNotice />);
    expect(out).toContain('role="alert"');
    expect(out).toContain("Pregnancy status could not be read. Check before prescribing.");
  });
});
