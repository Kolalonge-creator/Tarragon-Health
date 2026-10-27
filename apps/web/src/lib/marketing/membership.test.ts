/**
 * The public renewal sentences follow the platform's real renewal switch. Off (and any failed read) is the no-charge wording; on is the
 * opt-in wording. These tests pin both states, that on never says it renews for everyone, and that the read fails soft to OFF.
 */
import { membershipAutoRenews, renewalCopy } from "./membership";

let client: unknown;
jest.mock("./anon-client", () => ({ marketingAnonClient: () => client }));

describe("renewalCopy", () => {
  it("OFF: says it does not renew by itself, and mentions no card kept on file as a promise of renewal", () => {
    const c = renewalCopy(false, 21);
    for (const text of Object.values(c)) {
      expect(text).not.toMatch(/renews on that card|up to 3 days/);
    }
    expect(c.short).toMatch(/does not renew by itself/);
    expect(c.faqAnswer).toMatch(/^No\./);
    expect(c.faqAnswer).toContain("21 days");
    expect(c.pricingBox).toMatch(/does not renew by itself/);
    expect(c.promise).toMatch(/Nothing auto-renews/);
  });

  it("ON: renewal is something the person chooses, on a card, cancellable in one tap, keeping the paid year", () => {
    const c = renewalCopy(true, 21);
    expect(c.faqAnswer).toMatch(/Only if you choose it/);
    expect(c.faqAnswer).toMatch(/tick a box/);
    expect(c.faqAnswer).toMatch(/up to 3 days before/);
    expect(c.faqAnswer).toMatch(/bank transfer or USSD/);
    expect(c.faqAnswer).toMatch(/cancel in one tap/);
    expect(c.faqAnswer).toMatch(/keep the year you have paid for/);
    expect(c.faqAnswer).toContain("21 days");
    expect(c.short).toMatch(/unless you cancel/);
    expect(c.promise).toMatch(/only if you ask it to/);
  });

  it("ON never claims that everyone is renewed automatically", () => {
    for (const text of Object.values(renewalCopy(true, 21))) {
      expect(text).not.toMatch(/Membership renews automatically\./);
      expect(text).not.toMatch(/^Yes/);
    }
  });
});

describe("membershipAutoRenews", () => {
  const ask = (reply: () => unknown) => {
    client = { rpc: () => Promise.resolve(reply()) };
    return membershipAutoRenews();
  };

  it("is true only when the database says exactly true", async () => {
    expect(await ask(() => ({ data: true, error: null }))).toBe(true);
    expect(await ask(() => ({ data: false, error: null }))).toBe(false);
    expect(await ask(() => ({ data: "true", error: null }))).toBe(false);
    expect(await ask(() => ({ data: null, error: null }))).toBe(false);
  });

  it("fails soft to OFF: a database error, a missing function, a throw, or no client", async () => {
    expect(await ask(() => ({ data: true, error: { message: "function does not exist" } }))).toBe(false);
    client = { rpc: () => { throw new Error("down"); } };
    expect(await membershipAutoRenews()).toBe(false);
    client = { rpc: () => Promise.reject(new Error("network")) };
    expect(await membershipAutoRenews()).toBe(false);
    client = null;
    expect(await membershipAutoRenews()).toBe(false);
  });
});
