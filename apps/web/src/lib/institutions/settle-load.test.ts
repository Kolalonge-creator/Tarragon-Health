jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

import * as Sentry from "@sentry/nextjs";
import { failed, loadedValue, settleLoad } from "./settle-load";

describe("settleLoad", () => {
  it("keeps a failed read apart from an empty one", async () => {
    const empty = await settleLoad("x", async () => null);
    expect(empty).toEqual({ ok: true, value: null });
    expect(failed(empty)).toBe(false);

    const broken = await settleLoad("x", async () => {
      throw new Error("boom");
    });
    expect(broken).toEqual({ ok: false });
    expect(failed(broken)).toBe(true);
    expect(loadedValue(broken)).toBeNull();
  });

  it("reports the failure with its label and does not rethrow", async () => {
    await settleLoad("hmo.care_gaps", async () => {
      throw new Error("boom");
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { institutionLoad: "hmo.care_gaps" },
    });
  });

  it("passes a good value through", async () => {
    const r = await settleLoad("x", async () => 7);
    expect(loadedValue(r)).toBe(7);
  });
});
