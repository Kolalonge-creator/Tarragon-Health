/** @jest-environment jsdom */
/**
 * Coverage for useOutstandingConsentTypes: the shared computation both
 * ConsentStatusPanel (the review UI) and ConsentNudgeBanner (the dashboard
 * nudge) rely on to decide "does this patient have anything to accept right
 * now." A consent_type only counts as outstanding when there is no
 * patient_consents row matching BOTH its type and its current version — an
 * older accepted version of the same type must still show as outstanding
 * (that's the whole point of a version bump), while a type accepted at the
 * current version must not.
 */
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOutstandingConsentTypes } from "./consent";

const mockFrom = jest.fn();
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: mockFrom }),
}));

type Row = Record<string, unknown>;

/**
 * usePatientConsents awaits `.eq(...)` directly; useCurrentConsentVersions
 * chains `.eq(...).order(...)` before awaiting. A real PostgrestFilterBuilder
 * is thenable AND chainable at once, so this double returns a Promise with
 * an `.order` method attached, satisfying both call shapes.
 */
function fromTable(rows: Row[]) {
  return {
    select: () => ({
      eq: () => {
        const result = Promise.resolve({ data: rows, error: null });
        (result as unknown as { order: () => Promise<{ data: Row[]; error: null }> }).order = () =>
          Promise.resolve({ data: rows, error: null });
        return result;
      },
    }),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useOutstandingConsentTypes", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("marks a never-accepted type and a stale (older-version) type as outstanding, but not a current one", async () => {
    const versions = [
      { id: "v-dp-2", consent_type: "data_processing", version: 2 },
      { id: "v-tel-1", consent_type: "telehealth", version: 1 },
      { id: "v-tos-1", consent_type: "terms_of_service", version: 1 },
    ];
    // data_processing accepted at v1 (now stale, current is v2) — outstanding.
    // telehealth never accepted at all — outstanding.
    // terms_of_service accepted at the current v1 — NOT outstanding.
    const accepted = [
      { consent_type: "data_processing", version: 1, accepted_at: "2026-01-01" },
      { consent_type: "terms_of_service", version: 1, accepted_at: "2026-01-01" },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "consent_versions") return fromTable(versions);
      if (table === "patient_consents") return fromTable(accepted);
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useOutstandingConsentTypes("patient-1"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.outstanding.map((v) => v.consent_type).sort()).toEqual([
      "data_processing",
      "telehealth",
    ]);
  });

  it("reports nothing outstanding when every current version has a matching accepted row", async () => {
    const versions = [{ id: "v-tos-1", consent_type: "terms_of_service", version: 1 }];
    const accepted = [{ consent_type: "terms_of_service", version: 1, accepted_at: "2026-01-01" }];

    mockFrom.mockImplementation((table: string) => {
      if (table === "consent_versions") return fromTable(versions);
      if (table === "patient_consents") return fromTable(accepted);
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useOutstandingConsentTypes("patient-1"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.outstanding).toEqual([]);
  });
});
