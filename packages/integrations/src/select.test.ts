import { describe, expect, it } from "@jest/globals";
import { createMockPayment, createMockVideo, environmentFrom, selectProvider } from "../../../supabase/functions/_shared/integrations/index.ts";

describe("selectProvider", () => {
  it("never hands out a mock in production, whether or not a real provider exists", () => {
    const none = selectProvider({ environment: "production", real: null, mock: () => createMockPayment() });
    expect(none.ok === false && none.error.code).toBe("not_configured");
    const mockAsReal = selectProvider({ environment: "production", real: createMockVideo(), mock: () => createMockVideo() });
    expect(mockAsReal.ok === false && mockAsReal.error.code).toBe("not_configured");
  });

  it("uses a real provider whenever one is configured", () => {
    const real = { isMock: false, id: "paystack" };
    const r = selectProvider({ environment: "production", real, mock: () => ({ isMock: true, id: "mock" }) });
    expect(r.ok && r.data.id).toBe("paystack");
    const s = selectProvider({ environment: "staging", real, mock: () => ({ isMock: true, id: "mock" }) });
    expect(s.ok && s.data.id).toBe("paystack");
  });

  it("falls back to a mock in development, test and staging", () => {
    for (const environment of ["development", "test", "staging"] as const) {
      const r = selectProvider({ environment, real: null, mock: () => createMockPayment() });
      expect(r.ok && r.data.isMock).toBe(true);
    }
  });

  it("reads APP_ENV, and treats anything unrecognised as production so a typo cannot switch a mock on", () => {
    expect(environmentFrom("staging")).toBe("staging");
    expect(environmentFrom("development")).toBe("development");
    expect(environmentFrom("test")).toBe("test");
    for (const v of [undefined, "", "prod", "Production", "dev", "stagging"]) expect(environmentFrom(v)).toBe("production");
  });
});
