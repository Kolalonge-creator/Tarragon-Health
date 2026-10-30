/** @jest-environment jsdom */
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { parseAnalyticsAnswer } from "@/lib/analytics/answer";
import { businessSummarySchema } from "@/lib/analytics/schemas";

let mockPath = "/analytics/business";
jest.mock("next/navigation", () => ({ usePathname: () => mockPath }));

import { AnalyticsLoadNotice } from "./load-notice";

/** Stands in for a dashboard: mounts one query and renders nothing of its own. */
function Figure({ queryKey, queryFn }: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) {
  useQuery({ queryKey, queryFn, retry: false });
  return null;
}

function mount(figures: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnalyticsLoadNotice />
      {figures}
    </QueryClientProvider>
  );
  return client;
}

const KEY = ["analytics", "business-summary"];

beforeEach(() => {
  mockPath = "/analytics/business";
});

describe("AnalyticsLoadNotice", () => {
  it("says nothing when every figure loaded", async () => {
    const fn = jest.fn().mockResolvedValue({ ok: true });
    mount(<Figure queryKey={KEY} queryFn={fn} />);
    await waitFor(() => expect(fn).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says so, loudly, when a figure could not be loaded", async () => {
    mount(<Figure queryKey={KEY} queryFn={() => Promise.reject(new Error("network down"))} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be loaded/);
    expect(alert.textContent).toMatch(/missing, not that there is none/);
  });

  it("treats a refused answer as a failure, end to end through the guard", async () => {
    // The empty object an RPC returns to a refused caller. Before the guard
    // this parsed to zeros and nothing here would have appeared.
    const refused = async () => parseAnalyticsAnswer(businessSummarySchema, {});
    mount(<Figure queryKey={KEY} queryFn={refused} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be loaded/);
  });

  it("offers a retry that refetches the failed figure and clears the notice", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue({ ok: true });
    mount(<Figure queryKey={KEY} queryFn={fn} />);

    await screen.findByRole("alert");
    expect(fn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("is softer when the last good figures are still on screen", async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValue(new Error("refresh failed"));
    const client = mount(<Figure queryKey={KEY} queryFn={fn} />);

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await act(async () => {
      await client.invalidateQueries({ queryKey: KEY });
    });

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/may be out of date/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a retry in progress and refuses a second click until it finishes", async () => {
    // The last good figures are still on screen (stale), so the notice stays
    // up while the retry runs: that is when feedback matters.
    let finishRetry: (value: unknown) => void = () => {};
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockImplementationOnce(() => new Promise((resolve) => (finishRetry = resolve)));
    const client = mount(<Figure queryKey={KEY} queryFn={fn} />);

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await act(async () => {
      await client.invalidateQueries({ queryKey: KEY });
    });
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    const busy = await screen.findByRole("button", { name: "Trying again…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(fn).toHaveBeenCalledTimes(3); // initial, the failed refresh, ONE retry

    await act(async () => finishRetry({ ok: true }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("steps aside on pages that already report their own failures", async () => {
    mockPath = "/analytics/investor";
    const fn = jest.fn().mockRejectedValue(new Error("down"));
    mount(<Figure queryKey={["analytics", "investor-summary"]} queryFn={fn} />);
    await waitFor(() => expect(fn).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a failure in a query that is not an analytics figure", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("down"));
    mount(<Figure queryKey={["patients", "list"]} queryFn={fn} />);
    await waitFor(() => expect(fn).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
