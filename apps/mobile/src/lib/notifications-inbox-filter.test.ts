const calls: Array<[string, ...unknown[]]> = [];
const chain: Record<string, (...args: unknown[]) => unknown> = {};
for (const name of ["select", "eq", "not", "order"]) {
  chain[name] = (...args: unknown[]) => {
    calls.push([name, ...args]);
    return chain;
  };
}
chain.limit = (...args: unknown[]) => {
  calls.push(["limit", ...args]);
  return Promise.resolve({ data: [], error: null });
};
jest.mock("./supabase", () => ({ supabase: { from: () => chain } }));

import { loadNotifications } from "./notifications";

describe("loadNotifications", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("never shows failed or suppressed rows, the same as the web inbox", async () => {
    await loadNotifications("user-1");
    expect(calls).toContainEqual(["not", "status", "in", "(failed,suppressed)"]);
  });

  it("still reads only this person's in-app rows", async () => {
    await loadNotifications("user-1");
    expect(calls).toContainEqual(["eq", "recipient_id", "user-1"]);
    expect(calls).toContainEqual(["eq", "channel", "in_app"]);
  });
});
