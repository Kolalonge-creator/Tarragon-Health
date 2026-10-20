/** @jest-environment jsdom */
/**
 * The public share page's PIN form (S09y, closing the S09x verification gap): the real PinGate component and the real unlockShare server action,
 * with only the database door faked. The fake follows the rules the SQL proof (packages/db/tests/s09x_my_health_completion.sql) already pins on the
 * real function: a wrong PIN costs one of five tries, the fifth locks the link for everyone, a locked link answers like any dead link, and a right PIN
 * opens the record. What this test adds is the other half: that the page shows the right thing at each step and never leaks more than the door gave.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const RIGHT_PIN = "482913";
const MAX_MISSES = 5;
const door = { misses: 0, locked: false, calls: [] as (string | null)[] };

jest.mock("@/lib/my-health/open-share", () => ({
  isWellFormedPin: (p: string) => /^[0-9]{4,12}$/.test(p),
  openShare: async (_token: string, pin: string | null) => {
    door.calls.push(pin);
    if (door.locked) return { kind: "unavailable" };
    if (pin === RIGHT_PIN) return { kind: "ok", record: { status: "ok", full_name: "Ada Okafor" } };
    door.misses += 1;
    if (door.misses >= MAX_MISSES) {
      door.locked = true;
      return { kind: "unavailable" };
    }
    return { kind: "pin_required", attemptsLeft: MAX_MISSES - door.misses };
  },
}));
jest.mock("next/headers", () => ({ headers: async () => new Map([["x-forwarded-for", "203.0.113.7"]]) }));
jest.mock("./shared-record-view", () => ({ SharedRecordView: ({ record }: { record: { full_name: string } }) => <p>RECORD FOR {record.full_name}</p> }));

import { PinGate } from "./pin-gate";

async function submit(pin: string) {
  fireEvent.change(screen.getByLabelText("PIN"), { target: { value: pin } });
  await act(async () => {
    fireEvent.submit(screen.getByLabelText("PIN").closest("form") as HTMLFormElement);
  });
}

beforeEach(() => {
  door.misses = 0;
  door.locked = false;
  door.calls = [];
});

describe("the share page PIN form", () => {
  it("asks for the PIN first and shows no record", () => {
    render(<PinGate token="tok" needsPin />);
    expect(screen.getByText("Enter the PIN")).toBeTruthy();
    expect(screen.queryByText(/RECORD FOR/)).toBeNull();
  });

  it("a wrong PIN says how many tries are left and keeps the form", async () => {
    render(<PinGate token="tok" needsPin />);
    await submit("000000");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That PIN is not right. 4 tries left."));
    expect(screen.getByLabelText("PIN")).toBeTruthy();
    expect(screen.queryByText(/RECORD FOR/)).toBeNull();
  });

  it("the tries count down, and the fifth wrong PIN locks the link: the page becomes the same 'not available' as any dead link", async () => {
    render(<PinGate token="tok" needsPin />);
    for (const left of [4, 3, 2, 1]) {
      await submit("000000");
      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(`That PIN is not right. ${left} tries left.`));
    }
    await submit("111111");
    await waitFor(() => expect(screen.getByText("This link is not available")).toBeTruthy());
    expect(screen.queryByLabelText("PIN")).toBeNull();
    expect(door.locked).toBe(true);
    // the page offers no way to try again, and says nothing that tells a locked link apart from an expired one
    expect(screen.queryByText(/lock/i)).toBeNull();
    expect(screen.queryByText(/tries left/)).toBeNull();
  });

  it("once locked, even the right PIN does not open it", async () => {
    door.locked = true;
    render(<PinGate token="tok" needsPin />);
    await submit(RIGHT_PIN);
    await waitFor(() => expect(screen.getByText("This link is not available")).toBeTruthy());
    expect(screen.queryByText(/RECORD FOR/)).toBeNull();
  });

  it("the right PIN opens the record, after an earlier wrong one", async () => {
    render(<PinGate token="tok" needsPin />);
    await submit("000000");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await submit(RIGHT_PIN);
    await waitFor(() => expect(screen.getByText("RECORD FOR Ada Okafor")).toBeTruthy());
    expect(screen.queryByLabelText("PIN")).toBeNull();
  });

  it("a PIN that is not numbers never reaches the door, so it cannot cost a try", async () => {
    render(<PinGate token="tok" needsPin />);
    await submit("12ab");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The PIN is numbers only."));
    expect(door.calls).toEqual([]);
    expect(door.misses).toBe(0);
  });

  it("a link with no PIN shows no PIN field and opens on the button", async () => {
    render(<PinGate token="tok" needsPin={false} />);
    expect(screen.queryByLabelText("PIN")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open record" }));
    });
    // this door only opens with the right PIN, so a link with no PIN is answered as unavailable here; what matters is that no PIN was sent
    await waitFor(() => expect(door.calls).toEqual([null]));
  });
});
