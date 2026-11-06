/** @jest-environment jsdom */
/**
 * Review fix: while a new timeline filter loads, the previous filter's rows are not shown under it; while "Load more" loads
 * (same filter), the rows already shown stay.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let pending: Promise<unknown> | null = null;
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) b[m] = () => b;
    b.range = () => pending ?? Promise.resolve({ data: [{ id: "r1", actor_clinical_staff_id: null }], error: null });
    return { from: () => b };
  },
}));

import { usePatientTimeline } from "./patient-timeline";
import type { TimelineEventType } from "./patient-timeline";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => (pending = null));

it("drops the old rows on a filter change but keeps them on Load more", async () => {
  const { result, rerender } = renderHook(
    ({ limit, types }: { limit: number; types: TimelineEventType[] | null }) => usePatientTimeline("p1", limit, 0, types),
    { wrapper, initialProps: { limit: 10, types: null as TimelineEventType[] | null } },
  );
  await waitFor(() => expect(result.current.data).toHaveLength(1));

  pending = new Promise(() => {});
  rerender({ limit: 20, types: null });
  expect(result.current.data).toHaveLength(1);

  rerender({ limit: 10, types: ["lab_completed"] });
  expect(result.current.data).toBeUndefined();
});
