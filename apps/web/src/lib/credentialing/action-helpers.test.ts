import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { csv, endOfLagosDay, run, safeReturnTo, withOutcome } from "./action-helpers";
import { CredentialingError } from "./rpc";

describe("safeReturnTo", () => {
  it("accepts a credentialing page and drops any query string", () => {
    expect(safeReturnTo("/admin/credentialing/abc?ok=1", "/x")).toBe("/admin/credentialing/abc");
    expect(safeReturnTo("/clinician/credentials", "/x")).toBe("/clinician/credentials");
    expect(safeReturnTo("/account/clinician/test", "/x")).toBe("/account/clinician/test");
  });

  it("refuses anything that could leave the credentialing pages", () => {
    expect(safeReturnTo("https://evil.example/admin/credentialing", "/x")).toBe("/x");
    expect(safeReturnTo("//evil.example/admin/credentialing", "/x")).toBe("/x");
    expect(safeReturnTo("/admin/credentialing/../settings", "/x")).toBe("/x");
    expect(safeReturnTo("/admin/credentialing/%2e%2e/settings", "/x")).toBe("/x");
    expect(safeReturnTo("/patient", "/x")).toBe("/x");
    expect(safeReturnTo("/admin/credentialingx", "/x")).toBe("/x");
    expect(safeReturnTo("\\admin\\credentialing", "/x")).toBe("/x");
    expect(safeReturnTo(null, "/x")).toBe("/x");
  });
});

describe("withOutcome and run", () => {
  it("encodes the outcome into the return path", () => {
    expect(withOutcome("/a", { ok: "Done & dusted" })).toBe("/a?ok=Done%20%26%20dusted");
    expect(withOutcome("/a", { error: "No" })).toBe("/a?error=No");
  });

  it("redirects with the success message", async () => {
    await expect(run("/account/clinician", async () => "Saved.")).rejects.toThrow("REDIRECT:/account/clinician?ok=Saved.");
  });

  it("redirects with the human message of a database refusal, never swallowing it", async () => {
    await expect(
      run("/account/clinician", async () => {
        throw new CredentialingError("give a reason of at least 10 characters", "23514");
      }),
    ).rejects.toThrow("REDIRECT:/account/clinician?error=give%20a%20reason%20of%20at%20least%2010%20characters");
  });

  it("hides the detail of an unexpected failure", async () => {
    await expect(
      run("/account/clinician", async () => {
        throw new Error("connection string leaked: postgres://secret");
      }),
    ).rejects.toThrow("REDIRECT:/account/clinician?error=Something%20went%20wrong.%20Please%20try%20again.");
  });
});

describe("small parsers", () => {
  it("splits a comma list and caps it", () => {
    expect(csv(" English, Yoruba ,, ")).toEqual(["English", "Yoruba"]);
    expect(csv(Array.from({ length: 30 }, (_, i) => `l${i}`).join(",")).length).toBe(20);
  });

  it("turns a date into the end of that Lagos day, and refuses anything else", () => {
    expect(endOfLagosDay("2027-03-14")).toBe("2027-03-14T23:59:59+01:00");
    expect(endOfLagosDay("14/03/2027")).toBeNull();
    expect(endOfLagosDay("")).toBeNull();
  });
});
