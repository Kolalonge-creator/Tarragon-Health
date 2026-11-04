/** @jest-environment jsdom */
/** Care Circle P5: what someone who paid for another person's care sees. Billing facts only, and a line saying paying grants no access. */
import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { endsSoonForRenewal } from "@/lib/care-circle/model";
import { GiftsPaid } from "./gifts-paid";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
let gifts: { isSuccess: boolean; data: unknown[] };
jest.mock("@/lib/queries/care-circle", () => {
  const actual = jest.requireActual("@/lib/queries/care-circle");
  return { ...actual, useGiftsPaid: () => gifts };
});

const DAY = 86_400_000;
const soon = new Date(Date.now() + 10 * DAY).toISOString();
const later = new Date(Date.now() + 200 * DAY).toISOString();

describe("GiftsPaid", () => {
  it("shows nothing when nothing was paid", () => {
    gifts = { isSuccess: true, data: [] };
    const { container } = render(<GiftsPaid locale="en" />);
    expect(container.textContent).toBe("");
  });

  it("lists each gift by first name with its state, and says paying grants no access", async () => {
    gifts = {
      isSuccess: true,
      data: [
        { order_id: "o1", name: "Mama", name_key: null, paid_at: "2026-11-01T10:00:00Z", state: "accepted", starts_at: "2026-11-01T10:00:00Z", ends_at: later, refund_state: null },
        { order_id: "o2", name: "Papa", name_key: null, paid_at: "2026-11-02T10:00:00Z", state: "not_answered", starts_at: null, ends_at: null, refund_state: "requested" },
        { order_id: "o3", name: "Aunty", name_key: null, paid_at: "2026-11-03T10:00:00Z", state: "waiting", starts_at: null, ends_at: null, refund_state: null },
      ],
    };
    render(<GiftsPaid locale="en" />);
    expect(screen.getByText(/does not let you see their health information/)).toBeTruthy();
    expect(screen.getByText(/Active until/)).toBeTruthy();
    expect(screen.getByText("Papa did not answer in time")).toBeTruthy();
    expect(screen.getByText("Waiting for Aunty to accept")).toBeTruthy();
    expect(screen.getByText("Refund: requested")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Give another year" })).toBeNull();
    await expectNoA11yViolations(<GiftsPaid locale="en" />);
  });

  it("offers another year only when an accepted Membership ends within 30 days", () => {
    expect(endsSoonForRenewal(soon, Date.now())).toBe(true);
    expect(endsSoonForRenewal(later, Date.now())).toBe(false);
    gifts = { isSuccess: true, data: [{ order_id: "o1", name: "Mama", name_key: null, paid_at: null, state: "accepted", starts_at: null, ends_at: soon, refund_state: null }] };
    render(<GiftsPaid locale="en" />);
    expect(screen.getByRole("link", { name: "Give another year" }).getAttribute("href")).toBe("/patient/supporting/new");
  });
});
