/** @jest-environment jsdom */
import { render } from "@testing-library/react";

// A lazy thenable, like the real Supabase query builder: it records a call only when something subscribes with `.then`.
const sent: Array<{ fn: string; args: Record<string, unknown> }> = [];
let failRequests = false;
function lazyRpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: null }> {
  return {
    then(onFulfilled?: (v: { error: null }) => unknown, onRejected?: (e: unknown) => unknown) {
      sent.push({ fn, args });
      const outcome = failRequests ? Promise.reject(new Error("offline")) : Promise.resolve({ error: null });
      return outcome.then(onFulfilled, onRejected);
    },
  } as PromiseLike<{ error: null }>;
}

jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: lazyRpc }) }));
jest.mock("./on-call-alarm", () => ({ deviceId: () => "web-test-device" }));

import { TestPageReceipt } from "./test-page-receipt";

describe("TestPageReceipt", () => {
  beforeEach(() => {
    sent.length = 0;
    failRequests = false;
  });

  it("actually sends the delivered receipt for the pending test page (a lazy query that is never awaited sends nothing)", () => {
    render(<TestPageReceipt testId="8580d6b1-6508-4fcc-87f3-753a48f0e628" />);
    expect(sent).toEqual([
      { fn: "record_page_delivered", args: { p_ref: "8580d6b1-6508-4fcc-87f3-753a48f0e628", p_channel: "in_app", p_device: "web-test-device" } },
    ]);
  });

  it("sends a fresh receipt when a different test page becomes pending", () => {
    const { rerender } = render(<TestPageReceipt testId="aaaaaaaa-0000-4000-8000-000000000001" />);
    rerender(<TestPageReceipt testId="aaaaaaaa-0000-4000-8000-000000000002" />);
    expect(sent.map((s) => s.args.p_ref)).toEqual(["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002"]);
  });

  it("swallows a failed request instead of raising an unhandled rejection into the page", async () => {
    failRequests = true;
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    render(<TestPageReceipt testId="aaaaaaaa-0000-4000-8000-000000000003" />);
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", unhandled);
    expect(sent).toHaveLength(1);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
