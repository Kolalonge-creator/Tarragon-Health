/** @jest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { foundingLadderPriceLabels, membershipLadderPriceLabels } from "@/lib/marketing/membership";
import { FoundingMembersPanel, FoundingMembersStrip } from "./founding-members-strip";

const load = jest.fn();
jest.mock("@/lib/marketing/founding-offer", () => ({ loadFoundingOffer: () => load() }));

const OFFER = { placesTotal: 100, placesLeft: 37, code: "FOUNDING10", percent: 10 };

afterEach(() => {
  cleanup();
  load.mockReset();
});

describe("FoundingMembersPanel", () => {
  it("says the offer, the places left, the code to type and the fine print, every figure from the offer or config", async () => {
    render(<FoundingMembersPanel offer={OFFER} ladder />);
    expect(screen.getByRole("heading", { level: 2, name: "Founding members: 10% off your first year" })).toBeTruthy();
    expect(screen.getByTestId("founding-places").textContent).toBe("37 of 100 places left");
    expect(screen.getByText("FOUNDING10")).toBeTruthy();
    expect(screen.getByText(/enter this code at checkout/)).toBeTruthy();
    const founding = foundingLadderPriceLabels(10);
    const list = membershipLadderPriceLabels();
    expect(screen.getByText(founding.evergreen)).toBeTruthy();
    expect(screen.getByText(founding.evergreenPlus)).toBeTruthy();
    expect(screen.getByText(`First year, usually ${list.evergreen}`)).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/first year of Membership or Membership Plus only/);
    expect(text).toMatch(/One use per person/);
    expect(text).toMatch(/while places last/i);
    expect(text).not.toMatch(/—/);
    expect(text).not.toMatch(/hurry|instal?ments?|doctor-led|whatsapp/i);
    cleanup();
    await expectNoA11yViolations(<FoundingMembersPanel offer={OFFER} ladder />);
  });

  it("shows no prices while the ladder is not public, only the percent", () => {
    render(<FoundingMembersPanel offer={OFFER} ladder={false} />);
    expect(document.body.textContent).not.toMatch(/₦/);
    expect(screen.getByText("Founding members: 10% off your first year")).toBeTruthy();
  });
});

describe("FoundingMembersStrip", () => {
  it("renders nothing when the offer is closed, full or unreadable", async () => {
    load.mockResolvedValue(null);
    const { container } = render(<>{await FoundingMembersStrip({})}</>);
    expect(container.textContent).toBe("");
  });

  it("renders the panel when the offer is open", async () => {
    load.mockResolvedValue(OFFER);
    render(<>{await FoundingMembersStrip({})}</>);
    expect(screen.getByTestId("founding-members")).toBeTruthy();
  });
});
