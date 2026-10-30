/** @jest-environment jsdom */
/** Design audit P3: only the latest three released results show; the rest fold behind a button. */
import { render, screen, fireEvent } from "@testing-library/react";

const rows: Record<string, unknown>[] = Array.from({ length: 5 }, (_, i) => ({
  lab_result_id: `r${i}`,
  received_at: `2026-0${i + 1}-10T08:00:00Z`,
  status: "pending",
  own_upload: false,
  expected_by: null,
  replaced: false,
  correction_kind: null,
  items: [],
}));

jest.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: rows, refetch: jest.fn() }) }));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
jest.mock("@/lib/lab-results/structured-actions", () => ({ addOwnLabResult: jest.fn(), getOwnResultFileUrl: jest.fn() }));

import { ReleasedLabResults } from "./released-lab-results";

describe("ReleasedLabResults cap", () => {
  it("shows three results, then all five after Show earlier results", () => {
    const { container } = render(<ReleasedLabResults patientId="p1" locale="en" />);
    expect(container.querySelectorAll("ul > li.rounded-lg")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Show earlier results (2)" }));
    expect(container.querySelectorAll("ul > li.rounded-lg")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Show fewer results" })).not.toBeNull();
  });

  it("never folds away an old result that has a correction on it", () => {
    rows[4] = { ...rows[4], correction_kind: "amended" };
    const { container } = render(<ReleasedLabResults patientId="p1" locale="en" />);
    expect(container.querySelectorAll("ul > li.rounded-lg")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Show earlier results (1)" })).not.toBeNull();
    rows[4] = { ...rows[4], correction_kind: null };
  });
});
