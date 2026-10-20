/** @jest-environment jsdom */
/**
 * S08z: "My day" (the time of each part of the day, and "my day has shifted") and the "Tie this to my day" chooser. Accessibility
 * (axe), plus what the controls send.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { defaultsProfile } from "@/lib/medication-schedule/anchor-profile";
import type { ResolvedAnchor } from "@tarragon/medicines";
import { MyDayCard } from "./my-day-card";
import { AnchorChooser } from "./anchor-chooser";

const save = jest.fn();
const create = jest.fn();
const end = jest.fn();
let anchorData: unknown;
jest.mock("@/lib/queries/dose-anchors", () => ({
  useAnchors: () => ({ data: anchorData, isLoading: false }),
  useSaveAnchorTimes: () => ({ mutate: save, isPending: false }),
  useCreateDayShift: () => ({ mutate: create, isPending: false }),
  useEndDayShift: () => ({ mutate: end, isPending: false }),
}));

const NOW = Date.parse("2026-10-07T08:00:00Z");
beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"] });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  save.mockReset();
  create.mockReset();
  end.mockReset();
  anchorData = { profile: defaultsProfile(), timeRows: [], shiftRows: [], slotRows: [], loaded: true };
});

describe("MyDayCard", () => {
  it("has no axe violations closed, open, and with the shift form open", async () => {
    const { container } = await expectNoA11yViolations(<MyDayCard patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getAllByLabelText(/time/i).length).toBeGreaterThanOrEqual(10);
    const { axe } = await import("jest-axe");
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "My day has shifted" }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says a time that was never set is a proposed one, and saves only what was typed", async () => {
    anchorData = { profile: { ...defaultsProfile(), times: { lunch: [{ effectiveFrom: "2026-01-01", time: "13:30" }] } }, timeRows: [], shiftRows: [], slotRows: [], loaded: true };
    await expectNoA11yViolations(<MyDayCard patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getAllByText(/Not set yet/).length).toBe(9);
    fireEvent.change(screen.getByLabelText("Lunch: time"), { target: { value: "12:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my times" }));
    const sent = save.mock.calls[0]?.[0] as { patientId: string; times: Record<string, string> };
    expect(sent.patientId).toBe("p1");
    // Only what the patient typed is sent; a part of the day they did not touch keeps its proposed starting time until they set it.
    expect(sent.times).toEqual({ lunch: "12:45" });
  });

  it("says the new times apply from tomorrow when the database starts them tomorrow, and shows a database refusal as a message", async () => {
    await expectNoA11yViolations(<MyDayCard patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    fireEvent.change(screen.getByLabelText("Dinner: time"), { target: { value: "19:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my times" }));
    const opts = save.mock.calls[0]?.[1] as { onSuccess: (from: string) => void; onError: (e: unknown) => void };
    act(() => opts.onSuccess("2026-10-08"));
    expect((await screen.findByRole("status")).textContent).toMatch(/from tomorrow/);
    act(() => opts.onError({ code: "23514" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/too close together/);
  });

  it("refuses a shift with nothing to move, and sends a good one with only the parts that move", async () => {
    await expectNoA11yViolations(<MyDayCard patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    fireEvent.click(screen.getByRole("button", { name: "My day has shifted" }));
    fireEvent.click(screen.getByRole("button", { name: "Start this shift" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least one part/);
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Move dinner by"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Start this shift" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const sent = create.mock.calls[0]?.[0] as { clientId: string };
    expect(sent).toEqual({ patientId: "p1", clientId: expect.any(String), startsOn: "2026-10-07", endsOn: "2026-11-05", offsets: { dinner: 90 } });
    expect(sent.clientId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("shows a shift in force, and ends it after a confirmation", async () => {
    anchorData = {
      profile: defaultsProfile(),
      timeRows: [],
      shiftRows: [{ id: "s1", starts_on: "2026-10-01", ends_on: "2026-10-30", offsets: { dinner: 60 }, cancelled_from: null, created_at: "2026-10-01T00:00:00Z" }],
      slotRows: [],
      loaded: true,
    };
    await expectNoA11yViolations(<MyDayCard patientId="p1" />);
    expect(screen.getByText(/shifted until and including 2026-10-30/)).not.toBeNull();
    const confirm = jest.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Return to my usual day" }));
    expect(end).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Return to my usual day" }));
    expect(end.mock.calls[0]?.[0]).toEqual({ patientId: "p1", shiftId: "s1" });
    confirm.mockRestore();
  });

  it("says plainly when the person's own times could not be read", async () => {
    anchorData = { profile: defaultsProfile(), timeRows: [], shiftRows: [], slotRows: [], loaded: false };
    await expectNoA11yViolations(<MyDayCard patientId="p1" />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not save|Check the times/i);
  });
});

describe("AnchorChooser", () => {
  it("has no axe violations, adds an anchor with a plain-words offset choice, and a time to confirm", async () => {
    let value: ResolvedAnchor[] = [];
    const onChange = jest.fn((v: typeof value) => {
      value = v;
    });
    const { rerender } = await expectNoA11yViolations(<AnchorChooser profile={defaultsProfile()} value={value} onChange={onChange} drafts={{}} onDrafts={jest.fn()} />);
    expect(screen.getByText("Nothing chosen yet")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Breakfast" }));
    expect(onChange).toHaveBeenCalledWith([{ anchor: "breakfast", offsetMinutes: 0 }]);
    rerender(<AnchorChooser profile={defaultsProfile()} value={value} onChange={onChange} drafts={{}} onDrafts={jest.fn()} />);
    expect(screen.getByRole("button", { name: "with breakfast" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "30 minutes after breakfast" })).not.toBeNull();
    expect(screen.getByText(/Is .* right for breakfast/)).not.toBeNull();
    // The last offset cannot be removed; the anchor chip removes the anchor.
    fireEvent.click(screen.getByRole("button", { name: "with breakfast" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "30 minutes after breakfast" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { anchor: "breakfast", offsetMinutes: 0 },
      { anchor: "breakfast", offsetMinutes: 30 },
    ]);
  });

  it("removes an anchor and its typed time together", () => {
    const onChange = jest.fn();
    const onDrafts = jest.fn();
    render(<AnchorChooser profile={defaultsProfile()} value={[{ anchor: "dinner", offsetMinutes: 0 }]} onChange={onChange} drafts={{ dinner: "20:10" }} onDrafts={onDrafts} />);
    fireEvent.click(screen.getByRole("button", { name: "Dinner" }));
    expect(onChange).toHaveBeenCalledWith([]);
    expect(onDrafts).toHaveBeenCalledWith({});
  });

  it("shows a time the patient already confirmed as theirs, and lets them type another", () => {
    const onDrafts = jest.fn();
    const profile = { ...defaultsProfile(), times: { dinner: [{ effectiveFrom: "2026-01-01", time: "19:20" }] } };
    render(<AnchorChooser profile={profile} value={[{ anchor: "dinner", offsetMinutes: 0 }]} onChange={jest.fn()} drafts={{}} onDrafts={onDrafts} />);
    expect(screen.getByText("Usually around 19:20")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Dinner: time"), { target: { value: "19:40" } });
    expect(onDrafts).toHaveBeenCalledWith({ dinner: "19:40" });
  });
});
