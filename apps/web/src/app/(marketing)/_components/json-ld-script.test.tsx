import { renderToStaticMarkup } from "react-dom/server";
import { JsonLdScript, serializeJsonLd } from "./json-ld-script";

describe("serializeJsonLd", () => {
  it("escapes '<' so a string cannot close the script block", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});

describe("JsonLdScript", () => {
  it("renders an ld+json script", () => {
    const html = renderToStaticMarkup(<JsonLdScript data={{ "@type": "MedicalWebPage" }} />);
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain("MedicalWebPage");
  });
});
