import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const store = new Map<string, string>();
jest.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string) => void store.set(name, value),
    get: (name: string) => (store.has(name) ? { value: store.get(name) } : undefined),
  }),
}));

import { readFlash, setFlash } from "./flash";

beforeEach(() => store.clear());

describe("the one-shot notice", () => {
  it("shows only when the address carries the id the action put in the cookie", async () => {
    const id = await setFlash({ notice: "golive.done.switched_on", ok: true });
    expect(await readFlash(id)).toEqual({ id, notice: "golive.done.switched_on", ok: true });
    expect(await readFlash(undefined)).toBeNull();
    expect(await readFlash("11111111-1111-4111-8111-111111111111")).toBeNull();
  });

  it("cannot be forged by a link: no cookie, no notice, whatever the address says", async () => {
    expect(await readFlash("11111111-1111-4111-8111-111111111111")).toBeNull();
  });

  it("ignores a cookie that is not in the expected shape or names a notice that is not ours", async () => {
    store.set("golive_flash", "not json");
    expect(await readFlash("x")).toBeNull();
    store.set("golive_flash", JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", notice: "common.continue", ok: true }));
    expect(await readFlash("11111111-1111-4111-8111-111111111111")).toBeNull();
  });
});
