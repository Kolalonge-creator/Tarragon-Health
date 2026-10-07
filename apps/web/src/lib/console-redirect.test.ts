import { consoleBaseUrl, consoleRedirectTarget } from "./console-redirect";

describe("consoleRedirectTarget", () => {
  const base = "https://console.tarragonhealth.ng";

  it("carries the path and query of an extracted area to the console host", () => {
    expect(consoleRedirectTarget("/ngo", "", base)).toBe(`${base}/ngo`);
    expect(consoleRedirectTarget("/ngo/roster", "?tab=invites", base)).toBe(`${base}/ngo/roster?tab=invites`);
  });

  it("does nothing for a path that has not been extracted", () => {
    expect(consoleRedirectTarget("/clinician", "", base)).toBeNull();
    expect(consoleRedirectTarget("/patient", "", base)).toBeNull();
    expect(consoleRedirectTarget("/ngo-partners", "", base)).toBeNull();
    expect(consoleRedirectTarget("/", "", base)).toBeNull();
  });

  it("does nothing when no console is configured, so deploying first is safe", () => {
    expect(consoleRedirectTarget("/ngo", "", null)).toBeNull();
  });
});

describe("consoleBaseUrl", () => {
  const original = process.env.CONSOLE_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.CONSOLE_BASE_URL;
    else process.env.CONSOLE_BASE_URL = original;
  });

  it("returns the bare https origin and drops any path, query or credentials", () => {
    process.env.CONSOLE_BASE_URL = "https://user:pw@console.tarragonhealth.ng/some/path?x=1";
    expect(consoleBaseUrl()).toBe("https://console.tarragonhealth.ng");
  });

  it("allows plain http only for localhost", () => {
    process.env.CONSOLE_BASE_URL = "http://console.localhost:3001";
    expect(consoleBaseUrl()).toBe("http://console.localhost:3001");
    process.env.CONSOLE_BASE_URL = "http://console.tarragonhealth.ng";
    expect(consoleBaseUrl()).toBeNull();
  });

  it("returns null when unset or malformed", () => {
    delete process.env.CONSOLE_BASE_URL;
    expect(consoleBaseUrl()).toBeNull();
    process.env.CONSOLE_BASE_URL = "not a url";
    expect(consoleBaseUrl()).toBeNull();
    process.env.CONSOLE_BASE_URL = "javascript:alert(1)";
    expect(consoleBaseUrl()).toBeNull();
  });
});
