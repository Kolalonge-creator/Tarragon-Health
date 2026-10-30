/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

jest.mock("@/lib/lab-results/actions", () => ({ uploadResultDocumentForPatient: jest.fn() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

import { RecentUploads } from "./liaison-worklist";

describe("RecentUploads", () => {
  it("says nothing was uploaded only when the read worked and returned no rows", () => {
    render(<RecentUploads recent={[]} failed={false} />);
    expect(screen.getByText("No results uploaded yet.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns, and does not say nothing was uploaded, when the read failed", () => {
    render(<RecentUploads recent={[]} failed />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
    expect(screen.queryByText("No results uploaded yet.")).toBeNull();
  });
});
