/** @jest-environment jsdom */
/**
 * Slice H finding: a failed read of the readings history must show only "Could not load your readings.", never the empty line
 * "No readings logged yet." beside it (a failed read is not an empty record). The empty line still shows for a real empty result.
 */
import { render, screen } from "@testing-library/react";

let page: { data: unknown; isLoading: boolean; isError: boolean };
jest.mock("@/lib/queries/vitals", () => ({
  useVitalsReadingsPage: () => ({ ...page, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: jest.fn() }),
  useLastCuffCheck: () => ({ data: undefined }),
  useAssistedEntryAttribution: () => ({ data: undefined }),
}));
jest.mock("@/lib/queries/triage-results", () => ({ useOwnTriageResults: () => ({ data: undefined }) }));
jest.mock("@/components/measurement-units-provider", () => ({ useMeasurementUnits: () => undefined }));
jest.mock("@/components/glucose-unit-provider", () => ({ useGlucoseUnit: () => "mmol_l" }));
// Row-level controls (edit a reading, the triage note) are not under test and pull in server-only modules.
jest.mock("./reading-edit", () => ({ ChangedMarker: () => null, EditReading: () => null }));
jest.mock("./reading-triage-note", () => ({ ReadingTriageNote: () => null }));

import { VitalsHistory } from "./vitals-history";

describe("VitalsHistory on a failed or empty read", () => {
  it("shows only the error when the read fails", () => {
    page = { data: undefined, isLoading: false, isError: true };
    render(<VitalsHistory patientId="p1" />);
    expect(screen.getByText("Could not load your readings.")).not.toBeNull();
    expect(screen.queryByText("No readings logged yet.")).toBeNull();
  });

  it("shows the empty line when the read succeeds with no readings", () => {
    page = { data: { pages: [{ rows: [], hasMore: false }] }, isLoading: false, isError: false };
    render(<VitalsHistory patientId="p1" />);
    expect(screen.getByText("No readings logged yet.")).not.toBeNull();
    expect(screen.queryByText("Could not load your readings.")).toBeNull();
  });
});
