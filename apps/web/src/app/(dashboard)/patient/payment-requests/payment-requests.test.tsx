/** @jest-environment jsdom */
/**
 * S72 (19.13): asking a supporter to pay. The link is shown once and shared through the phone's own share sheet; it carries nothing about health;
 * an open request can be cancelled, a used or expired one cannot.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { PaymentRequests } from "./payment-requests";

const CODE = "pr_abcdefghijklmnopqrstuvwx";
const ITEM = { code: "membership_annual", kind: "membership", name_key: "catalog.membership_annual.name", description_key: "d", included_keys: [], duration_days: 365, uses: null, amount_kobo: 10_000_000, components: {} };
let requests: unknown[];
const create = jest.fn();
const cancel = jest.fn();
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return {
    ...actual,
    useCatalogue: () => ({ data: [ITEM, { ...ITEM, code: "other_item", kind: "consultation" }], isSuccess: true }),
    useMyPaymentRequests: () => ({ data: requests }),
    useCreatePaymentRequest: () => ({ mutateAsync: create, isPending: false }),
    useCancelPaymentRequest: () => ({ mutateAsync: cancel, isPending: false }),
  };
});

const row = (o: Record<string, unknown>) => ({ id: "r1", itemCode: "membership_annual", nameKey: "catalog.membership_annual.name", status: "open", createdAt: "2026-10-01T10:00:00Z", expiresAt: "2026-10-08T10:00:00Z", paidAt: null, ...o });
beforeEach(() => { requests = []; create.mockReset(); cancel.mockReset(); });
afterEach(() => { cleanup(); Reflect.deleteProperty(navigator, "share"); });

describe("PaymentRequests", () => {
  it("offers only the yearly Membership and passes the accessibility scan", async () => {
    await expectNoA11yViolations(<PaymentRequests locale="en" />);
    expect(screen.getAllByRole("button", { name: "Create a link" })).toHaveLength(1);
  });

  it("makes a link, shows it once, and shares it through the phone's own share sheet with a message that says nothing about health", async () => {
    create.mockResolvedValue({ requestId: "r1", code: CODE, expiresAt: "2026-10-08T10:00:00Z" });
    const share = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    render(<PaymentRequests locale="en" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create a link" })); });
    expect(create).toHaveBeenCalledWith({ itemCode: "membership_annual" });
    const shown = screen.getByTestId("request-link").textContent ?? "";
    expect(shown).toBe(`${window.location.origin}/checkout/${CODE}`);
    expect(screen.getByText(/we cannot show this link again/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Share the link" })); });
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0]![0] as { text: string; url: string; title: string };
    expect(arg.url).toBe(shown);
    expect(arg.text).toContain(shown);
    expect(`${arg.title} ${arg.text}`).not.toMatch(/diabet|hypertens|blood pressure|condition|illness|doctor|clinic|result/i);
  });

  it("falls back to copying when the phone has no share sheet", async () => {
    create.mockResolvedValue({ requestId: "r1", code: CODE, expiresAt: "2026-10-08T10:00:00Z" });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PaymentRequests locale="en" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create a link" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Share the link" })); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`/checkout/${CODE}`));
    await waitFor(() => expect(screen.getByText("Link copied")).toBeTruthy());
  });

  it("says why a link could not be made, in plain words", async () => {
    const { CheckoutError } = jest.requireActual("@/lib/queries/commerce");
    create.mockRejectedValue(new CheckoutError("already_member"));
    render(<PaymentRequests locale="en" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create a link" })); });
    expect(screen.getByText(/already a member/)).toBeTruthy();
  });

  it("lists requests with their state in words; only an open one can be cancelled", async () => {
    requests = [row({ id: "a" }), row({ id: "b", status: "paid", paidAt: "2026-10-02T00:00:00Z" }), row({ id: "c", status: "expired" }), row({ id: "d", status: "pending_payment" })];
    cancel.mockResolvedValue("cancelled");
    render(<PaymentRequests locale="en" />);
    expect(screen.getAllByRole("button", { name: "Cancel this link" })).toHaveLength(1);
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("Payment in progress")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel this link" })); });
    expect(cancel).toHaveBeenCalledWith("a");
  });

  it("tells the person when a payment is in progress and the link cannot be cancelled", async () => {
    requests = [row({ id: "a" })];
    cancel.mockResolvedValue("payment_in_progress");
    render(<PaymentRequests locale="en" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel this link" })); });
    expect(screen.getByText(/Someone is paying right now/)).toBeTruthy();
  });
});
