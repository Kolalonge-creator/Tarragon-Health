import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@sentry/nextjs", () => ({ withSentryConfig: (config: unknown) => config }));

type Rule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<Rule[]> {
  const mod = (await import("../../../next.config")) as { default: { headers: () => Promise<Rule[]> } };
  return mod.default.headers();
}
const csp = (rule: Rule) => rule.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";

describe("Content-Security-Policy for the in-app call", () => {
  it("keeps the strict policy everywhere else: no Zoom host, no wasm eval, no blob scripts", async () => {
    const all = (await rules()).find((r) => r.source === "/(.*)");
    const value = csp(all!);
    expect(value).toContain("default-src 'self'");
    expect(value).not.toMatch(/zoom/);
    expect(value).not.toContain("wasm-unsafe-eval");
    expect(value).not.toMatch(/script-src[^;]*blob:/);
    expect(value).not.toContain("unsafe-eval'");
  });

  it("widens it for the two consultation routes only, and only to Zoom's own hosts", async () => {
    const list = await rules();
    const room = list.find((r) => r.source.includes("consultation"));
    expect(room?.source).toBe("/(patient|clinician)/consultation/:encounterId");
    const value = csp(room!);
    expect(value).toMatch(/script-src [^;]*https:\/\/\*\.zoom\.us/);
    expect(value).toMatch(/connect-src [^;]*wss:\/\/\*\.zoom\.us/);
    expect(value).toContain("'wasm-unsafe-eval'");
    expect(value).toMatch(/worker-src 'self' blob:/);
    // it is still the strict policy plus Zoom: nothing else is opened up
    expect(value).toContain("object-src 'none'");
    expect(value).toContain("frame-ancestors 'self'");
    expect(value).not.toMatch(/'unsafe-eval'/);
    expect(value).not.toMatch(/\*(?!\.)/);
  });

  it("is declared after the general rule, because the last matching rule wins for the same header", async () => {
    const list = await rules();
    expect(list.findIndex((r) => r.source.includes("consultation"))).toBeGreaterThan(list.findIndex((r) => r.source === "/(.*)"));
  });

  it("still allows the camera and microphone the call needs", async () => {
    const all = (await rules()).find((r) => r.source === "/(.*)");
    expect(all?.headers.find((h) => h.key === "Permissions-Policy")?.value).toContain("camera=(self)");
    expect(all?.headers.find((h) => h.key === "Permissions-Policy")?.value).toContain("microphone=(self)");
  });
});
