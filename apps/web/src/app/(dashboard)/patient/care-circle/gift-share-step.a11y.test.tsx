/** @jest-environment jsdom */
/**
 * The "would you like [name] to see how you are doing?" step (2026-11-03). Nothing ticked at first; "Share the usual" ticks exactly
 * the usual four and the monthly report and sends NOTHING; only "Share what I ticked" sends; "Not now" sends nothing; an empty choice is
 * refused on screen; a full circle and a failure get plain messages. Axe-clean before and after interaction.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import { GiftShareStep } from "./gift-share-step";

const share = jest.fn();
const dismiss = jest.fn();
let pending = false;
jest.mock("@/lib/queries/care-circle", () => ({
  useShareWithGiftPayer: () => ({ mutateAsync: share, isPending: pending }),
  useDismissGiftPayer: () => ({ mutate: dismiss, isPending: false }),
}));

const PAYER = { payer_id: "8b0e1f4e-7d55-4a9b-9a51-1f5f0d6b2c11", first_name: "Chinedu", entitlement_ids: ["e1"], last_gift_at: null, is_member: false };
const box = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

beforeEach(() => {
  share.mockReset();
  dismiss.mockReset();
  pending = false;
});

describe("GiftShareStep", () => {
  it("names the payer, ticks nothing, and is axe-clean", async () => {
    const { container } = await expectNoA11yViolations(<GiftShareStep payer={PAYER} locale="en" />);
    expect(screen.getByRole("heading", { name: "Would you like Chinedu to see how you are doing?" })).toBeTruthy();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(7);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    expect(container.textContent).not.toContain("—");
  });

  it("falls back to a neutral phrase when the payer has no first name", () => {
    render(<GiftShareStep payer={{ ...PAYER, first_name: null }} locale="en" />);
    expect(screen.getByRole("heading", { name: "Would you like the person who paid to see how you are doing?" })).toBeTruthy();
  });

  it("'Share the usual' ticks the usual set and the monthly report, and sends nothing", async () => {
    const { container } = render(<GiftShareStep payer={PAYER} locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share the usual" })));
    expect(share).not.toHaveBeenCalled();
    expect(box(/blood pressure trend/).checked).toBe(true);
    expect(box(/taking my medicines/).checked).toBe(true);
    expect(box(/next appointment/).checked).toBe(true);
    expect(box(/check on me/).checked).toBe(true);
    expect(box(/monthly report/).checked).toBe(true);
    expect(box(/line from the doctor/).checked).toBe(false);
    expect(box(/Paying for my care/).checked).toBe(false);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("only 'Share what I ticked' sends, with exactly what was ticked, then confirms", async () => {
    share.mockResolvedValue({ ok: true, member_id: "m1", created: true, changed: true });
    render(<GiftShareStep payer={PAYER} locale="en" />);
    await act(async () => fireEvent.click(box(/line from the doctor/)));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share what I ticked" })));
    expect(share).toHaveBeenCalledWith({ payerId: PAYER.payer_id, permissions: ["doctor_note"], monthlyReport: false });
    expect(screen.getByRole("status").textContent).toMatch(/Chinedu can now see what you chose/);
  });

  it("refuses an empty choice on screen without calling the server", async () => {
    render(<GiftShareStep payer={PAYER} locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share what I ticked" })));
    expect(share).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/Tick at least one thing/);
  });

  it("'Not now' shares nothing, remembers the choice for this payer, and says so", async () => {
    const onDone = jest.fn();
    render(<GiftShareStep payer={PAYER} locale="en" onDone={onDone} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not now" })));
    expect(share).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledWith(PAYER.payer_id);
    expect(onDone).toHaveBeenCalledWith("not_now");
    expect(screen.getByRole("status").textContent).toMatch(/Nothing was shared, and we will not ask again/);
  });

  it("sharing never records a dismissal", async () => {
    share.mockResolvedValue({ ok: true, member_id: "m1", created: true, changed: true });
    render(<GiftShareStep payer={PAYER} locale="en" />);
    await act(async () => fireEvent.click(box(/next appointment/)));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share what I ticked" })));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("explains a full circle and a failure plainly", async () => {
    share.mockRejectedValueOnce(new Error("circle_full")).mockRejectedValueOnce(new Error("boom"));
    render(<GiftShareStep payer={PAYER} locale="en" />);
    await act(async () => fireEvent.click(box(/next appointment/)));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share what I ticked" })));
    expect(screen.getByRole("alert").textContent).toMatch(/Care Circle is full/);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share what I ticked" })));
    expect(screen.getByRole("alert").textContent).toMatch(/nothing was shared/);
  });

  it("every control is at least 44px tall (min-h-11)", () => {
    render(<GiftShareStep payer={PAYER} locale="en" />);
    for (const b of screen.getAllByRole("button")) expect(b.className).toContain("min-h-11");
  });
});
