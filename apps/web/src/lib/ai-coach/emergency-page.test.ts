/**
 * Review round (S52, INV-05): the self-harm page must be durable. A queue row is committed BEFORE the page is attempted, the wait is bounded,
 * a page still running when the wait ends is kept alive past the response with after(), and only a page that REALLY reached someone returns true.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

const after = jest.fn((cb: () => unknown) => {
  void cb();
});
jest.mock("next/server", () => ({ after }));

import { pageOnCallForSelfHarm } from "./emergency-page";

type Call = { fn: string };
function client(pageResult: () => Promise<{ data: unknown; error: { message: string } | null }>) {
  const calls: Call[] = [];
  const rpc = jest.fn(async (fn: string) => {
    calls.push({ fn });
    if (fn === "assistant_page_enqueue") return { data: "q1", error: null };
    return pageResult();
  });
  return { svc: { rpc } as unknown as SupabaseClient<Database>, calls };
}

describe("the on-call page is durable and honest", () => {
  it("queues first, then pages, and returns true only when someone was notified", async () => {
    const { svc, calls } = client(async () => ({ data: { notified: true }, error: null }));
    expect(await pageOnCallForSelfHarm(svc, "p1", "c1")).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual(["assistant_page_enqueue", "assistant_page_on_call"]);
  });

  it("a page that reached nobody is not reported as told", async () => {
    const { svc } = client(async () => ({ data: { notified: false, failed: true }, error: null }));
    expect(await pageOnCallForSelfHarm(svc, "p1", "c1")).toBe(false);
  });

  it("a page that errors is not reported as told, and the attempt was queued first", async () => {
    const { svc, calls } = client(async () => ({ data: null, error: { message: "db down" } }));
    expect(await pageOnCallForSelfHarm(svc, "p1", "c1")).toBe(false);
    expect(calls[0]?.fn).toBe("assistant_page_enqueue");
  });

  it("a slow page does not hold the reply: it returns false after the wait and is kept alive with after()", async () => {
    jest.useFakeTimers();
    after.mockClear();
    const { svc } = client(() => new Promise(() => undefined));
    const pending = pageOnCallForSelfHarm(svc, "p1", "c1");
    await jest.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe(false);
    expect(after).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("still attempts the page when the queue write fails", async () => {
    const rpc = jest.fn(async (fn: string) =>
      fn === "assistant_page_enqueue" ? { data: null, error: { message: "x" } } : { data: { notified: true }, error: null },
    );
    expect(await pageOnCallForSelfHarm({ rpc } as unknown as SupabaseClient<Database>, "p1", "c1")).toBe(true);
  });
});
