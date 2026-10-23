/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { DeviceSyncSupportCard } from "./device-sync-support-card";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const mockData = jest.fn();

jest.mock("@/lib/queries/device-diagnosis", () => ({ useDeviceDiagnosis: () => ({ data: mockData(), isLoading: false, isError: false }) }));
jest.mock("@/lib/queries/care-messages", () => ({ useStartThread: () => ({ mutate: jest.fn(), isPending: false, isError: false }) }));

const device = (id: string, over: Record<string, unknown>) => ({
  id,
  device_type: "bp_cuff",
  nickname: id,
  status: "active",
  last_synced_at: iso(0),
  last_sync_error: null,
  paired_at: iso(30),
  ...over,
});

function open() {
  render(<DeviceSyncSupportCard patientId="p1" />);
  fireEvent.click(screen.getByRole("button", { name: "Check my devices" }));
}

describe("DeviceSyncSupportCard states", () => {
  it("working: no fix button, and keeps the diagnostic summary", () => {
    mockData.mockReturnValue({ connections: [], devices: [device("fresh", {})] });
    open();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText(/Readings are arriving as expected/)).toBeTruthy();
    expect(screen.getByText(/No errors/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fix this" })).toBeNull();
  });

  it("never synced: waits for the first reading, no claim that readings arrive", () => {
    mockData.mockReturnValue({ connections: [], devices: [device("new", { last_synced_at: null })] });
    open();
    expect(screen.getByText("Waiting for the first reading")).toBeTruthy();
    expect(screen.queryByText(/arriving as expected/)).toBeNull();
  });

  it("stale: needs a quick fix with the date and the fix button", () => {
    mockData.mockReturnValue({ connections: [], devices: [device("old", { last_synced_at: iso(90) })] });
    open();
    expect(screen.getByText("Needs a quick fix")).toBeTruthy();
    expect(screen.getByText(/No readings since/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fix this" })).toBeTruthy();
  });

  it("error: shows the error detail and the fix button", () => {
    mockData.mockReturnValue({ connections: [], devices: [device("bad", { last_sync_error: "E42" })] });
    open();
    expect(screen.getByText(/Error: E42/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fix this" })).toBeTruthy();
  });

  it("paused connection reads Paused with Resume; unpaired reads Not set up", () => {
    mockData.mockReturnValue({
      connections: [{ id: "c1", provider: "fitbit", status: "paused", last_synced_at: iso(2), last_sync_error: null, connected_at: iso(40) }],
      devices: [device("gone", { status: "unpaired" })],
    });
    open();
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Resume" })).toBeTruthy();
    expect(screen.getByText("Not set up")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set it up" })).toBeTruthy();
  });
});
