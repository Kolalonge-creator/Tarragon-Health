/** @jest-environment jsdom */
/**
 * The profile read. It asks the audited path for each sensor source separately (so fingerstick rows cannot use up the limit), reports a source that
 * hit the limit as truncated, and keeps a refusal and an outage apart.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAgpReadings } from "./cgm";
import { AGP_READ_LIMIT, AgpReadError } from "@/lib/cgm/agp-read";

const mockRead = jest.fn();
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
jest.mock("@/lib/clinical/vitals-audited", () => ({
  readPatientVitalsAudited: (...args: unknown[]) => mockRead(...args),
  readPatientVitalsOrThrow: jest.fn(),
}));

const rows = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({ glucose_mmol_l: 6, taken_at: new Date(1_800_000_000_000 + (offset + i) * 300_000).toISOString() }));
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => mockRead.mockReset());

describe("useAgpReadings", () => {
  it("reads glucose from the cgm and wearable sources separately, and nothing else", async () => {
    mockRead.mockImplementation(async (_c: unknown, _p: string, opts: { source: string }) => ({ status: "ok", rows: opts.source === "cgm" ? rows(3) : rows(2, 10) }));
    const { result } = renderHook(() => useAgpReadings("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calls = mockRead.mock.calls.map((c) => ({ id: c[1] as string, ...(c[2] as { source: string }) }));
    expect(calls.map((c) => c.source).sort()).toEqual(["cgm", "wearable"]);
    for (const c of calls) expect(c).toMatchObject({ id: "p1", vitalType: "glucose", limit: AGP_READ_LIMIT });
    expect(result.current.data?.samples).toHaveLength(5);
    expect(result.current.data?.truncated).toBe(false);
  });

  it("reports truncation when a source returns exactly the limit", async () => {
    mockRead.mockImplementation(async (_c: unknown, _p: string, opts: { source: string }) => ({ status: "ok", rows: opts.source === "cgm" ? rows(AGP_READ_LIMIT) : [] }));
    const { result } = renderHook(() => useAgpReadings("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.truncated).toBe(true);
  });

  it("throws a denied error for a refusal and an error error for an outage, never an empty result", async () => {
    mockRead.mockResolvedValue({ status: "denied" });
    const denied = renderHook(() => useAgpReadings("p1"), { wrapper });
    await waitFor(() => expect(denied.result.current.isError).toBe(true));
    expect(denied.result.current.error).toBeInstanceOf(AgpReadError);
    expect((denied.result.current.error as AgpReadError).kind).toBe("denied");

    mockRead.mockResolvedValue({ status: "error", message: "network down" });
    const failed = renderHook(() => useAgpReadings("p2"), { wrapper });
    await waitFor(() => expect(failed.result.current.isError).toBe(true));
    expect((failed.result.current.error as AgpReadError).kind).toBe("error");
  });

  it("one refused source fails the whole read rather than drawing half a profile", async () => {
    mockRead.mockImplementation(async (_c: unknown, _p: string, opts: { source: string }) => (opts.source === "cgm" ? { status: "ok", rows: rows(3) } : { status: "denied" }));
    const { result } = renderHook(() => useAgpReadings("p3"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
