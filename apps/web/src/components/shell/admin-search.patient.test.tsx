/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AdminSearch } from "./admin-search";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const entries = [{ label: "Medications", href: "/patient/medications", group: "Care", keywords: "tablets" }];

function reply(body: unknown, ok = true) {
  return jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });
}

async function typeAndWait(value: string) {
  fireEvent.click(screen.getByRole("button", { name: "Search Tarragon" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
}

describe("patient search box", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("finds a page and looks up the patient's own record, never the staff people lookup", async () => {
    const fetchSpy = reply({ results: [], failed: false });
    global.fetch = fetchSpy as unknown as typeof fetch;
    render(<AdminSearch entries={entries} kind="patient" />);
    await typeAndWait("tablets");
    expect(screen.getByText("Medications")).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/^\/api\/patient\/search\?q=tablets$/);
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain("/api/admin/");
  });

  it("shows record matches grouped under Results, Medicines and Messages", async () => {
    global.fetch = reply({
      results: [
        { label: "HbA1c", href: "/patient/labs", group: "Results", hint: "Result from 3 Nov 2026" },
        { label: "Metformin", href: "/patient/medications", group: "Medicines", hint: "500 mg" },
        { label: "About my tablets", href: "/patient/messages", group: "Messages", hint: "…metformin…" },
      ],
      failed: false,
    }) as unknown as typeof fetch;
    render(<AdminSearch entries={entries} kind="patient" />);
    await typeAndWait("metformin");
    expect(screen.getByText("Results")).toBeTruthy();
    expect(screen.getByText("Medicines")).toBeTruthy();
    expect(screen.getByText("Messages")).toBeTruthy();
    expect(screen.getByText("Metformin")).toBeTruthy();
  });

  it("says the search failed instead of 'Nothing matches' when the record lookup fails", async () => {
    global.fetch = reply({}, false) as unknown as typeof fetch;
    render(<AdminSearch entries={entries} kind="patient" />);
    await typeAndWait("zzqq");
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't search your record/i);
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });

  it("says nothing matches only once the record lookup has answered", async () => {
    global.fetch = reply({ results: [], failed: false }) as unknown as typeof fetch;
    render(<AdminSearch entries={entries} kind="patient" />);
    await typeAndWait("zzqq");
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });
});
