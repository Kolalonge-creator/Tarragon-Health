import { wwwRedirectTarget } from "./host";

describe("www redirect target", () => {
  it("moves www to the bare host, keeping path and query", () => {
    expect(wwwRedirectTarget("https://www.tarragonhealth.ng/membership?utm_source=x")).toBe(
      "https://tarragonhealth.ng/membership?utm_source=x"
    );
    expect(wwwRedirectTarget("https://WWW.tarragonhealth.ng/")).toBe("https://tarragonhealth.ng/");
  });

  it("reads the Host header when the URL's host was normalised", () => {
    expect(wwwRedirectTarget("http://localhost:3000/membership?x=1", "www.tarragonhealth.ng")).toBe(
      "http://tarragonhealth.ng/membership?x=1"
    );
    expect(wwwRedirectTarget("https://tarragonhealth.ng/", "tarragonhealth.ng")).toBeNull();
  });

  it("never redirects to a host that is not Tarragon's own", () => {
    expect(wwwRedirectTarget("https://tarragonhealth.ng/", "www.attacker.example")).toBeNull();
    expect(wwwRedirectTarget("https://www.attacker.example/x")).toBeNull();
    expect(wwwRedirectTarget("https://tarragonhealth.ng/", "www.tarragonhealth.ng.attacker.example")).toBeNull();
  });

  it("leaves the bare host and the app host alone", () => {
    expect(wwwRedirectTarget("https://tarragonhealth.ng/")).toBeNull();
    expect(wwwRedirectTarget("https://app.tarragonhealth.ng/patient")).toBeNull();
    expect(wwwRedirectTarget("http://localhost:3000/")).toBeNull();
  });
});
