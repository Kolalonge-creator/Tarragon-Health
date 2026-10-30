/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { AdminSearch } from "./admin-search";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const entries = [{ label: "Medications", href: "/patient/medications", group: "Care", keywords: "tablets" }];

describe("patient search box", () => {
  it("finds a page and never calls the staff people lookup", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    jest.useFakeTimers();
    render(<AdminSearch entries={entries} kind="patient" />);
    fireEvent.click(screen.getByRole("button", { name: "Search Tarragon" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "tablets" } });
    jest.advanceTimersByTime(500);
    expect(screen.getByText("Medications")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
