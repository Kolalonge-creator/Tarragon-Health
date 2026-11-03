/** @jest-environment jsdom */
/**
 * The supporter's home list (supporter join path): one card per person, combining their Care Circle membership and anything the
 * supporter pays for; never "nobody yet" beside a person who is there; and no money summary until there is money. Axe-clean.
 */
import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { SupportingPeopleList } from "./supporting-people-list";

const idle = () => ({ data: undefined, isLoading: false, isPending: false, isError: false, isSuccess: false, mutate: jest.fn(), mutateAsync: jest.fn(), reset: jest.fn() });
let sponsored: { data: unknown[] | undefined; isLoading: boolean; isPending: boolean; isError: boolean };
let circle: { data: unknown[]; isSuccess: boolean };

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("./actions", () => ({ openTheirAccount: jest.fn(), paySomeonesBill: jest.fn(), paySomeonesPlan: jest.fn(), splitBillWithThem: jest.fn() }));
jest.mock("@/components/sponsor-care-report", () => ({ SponsorCareReport: () => null }));
jest.mock("./supporter-todays-doses", () => ({ SupporterTodaysDoses: () => null }));
jest.mock("./emergency-access-request", () => ({ EmergencyAccessRequest: () => null }));
jest.mock("@/components/care-message-thread", () => ({ CareMessageThread: () => null }));
jest.mock("@/lib/queries/sponsorship", () =>
  new Proxy({}, { get: (_t, key) => (key === "__esModule" ? true : key === "useSupportedPeople" ? () => sponsored : idle) }),
);
jest.mock("@/lib/queries/care-circle", () =>
  new Proxy({}, { get: (_t, key) => (key === "__esModule" ? true : key === "useSupportedPeople" ? () => circle : key === "useOpenAlerts" || key === "useUnansweredCheckIns" ? () => ({ data: [] }) : key === "useCheckInEnabled" ? () => ({ data: false }) : idle) }),
);
jest.mock("@/lib/queries/lab-orders", () => new Proxy({}, { get: (_t, key) => (key === "__esModule" ? true : idle) }));
jest.mock("@/lib/queries/care-messages", () => new Proxy({}, { get: (_t, key) => (key === "__esModule" ? true : idle) }));
jest.mock("@/lib/queries/service-products", () => new Proxy({}, { get: (_t, key) => (key === "__esModule" ? true : idle) }));

const ID = "11111111-2222-4333-8444-555555555555";
const CIRCLE_PERSON = { patient_id: ID, member_id: "m1", name: "Mama Eze", relationship: "Mother", permissions: ["red_alerts"], expires_at: "2027-06-01T00:00:00Z", alert_mode: "push_and_app" };
const SPONSORED = {
  profileId: ID,
  fullName: "Mama Eze",
  permissionLevel: "view",
  categories: [],
  isDependentAccount: false,
  readyVouchers: [],
  savingVouchers: [],
  usedVouchers: [],
  fundedKobo: 0,
  lastFundedAt: null,
};

beforeEach(() => {
  sponsored = { data: [], isLoading: false, isPending: false, isError: false };
  circle = { data: [], isSuccess: true };
});

describe("SupportingPeopleList", () => {
  it("shows a person in the Care Circle only once, even when the supporter also pays for them", async () => {
    circle = { data: [CIRCLE_PERSON], isSuccess: true };
    sponsored = { ...sponsored, data: [SPONSORED] };
    render(<SupportingPeopleList locale="en" />);
    expect(screen.getAllByText("Mama Eze")).toHaveLength(1);
    // the circle half sits on the same card: the way into what she shares
    expect(screen.getByRole("link", { name: "Open: Mama Eze's care" }).getAttribute("href")).toBe(`/patient/supporting/circle/${ID}`);
  });

  it("never says nobody is here next to a Care Circle card", async () => {
    circle = { data: [CIRCLE_PERSON], isSuccess: true };
    render(<SupportingPeopleList locale="en" />);
    expect(screen.getByText("Mama Eze")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/not supporting anyone|No one has shared/);
    await expectNoA11yViolations(<SupportingPeopleList locale="en" />);
  });

  it("shows one calm empty state when there is truly nobody", async () => {
    render(<SupportingPeopleList locale="en" />);
    expect(screen.getByRole("heading", { name: "No one has shared their care with you yet" })).toBeTruthy();
    await expectNoA11yViolations(<SupportingPeopleList locale="en" />);
  });

  it("does not open on a money summary before any money has moved", () => {
    sponsored = { ...sponsored, data: [SPONSORED] };
    render(<SupportingPeopleList locale="en" />);
    expect(screen.queryByText(/paid for and waiting to be used$/)).toBeNull();
    expect(screen.queryByText(/people you support|person you support/)).toBeNull();
  });

  it("lists no Care Circle card until the paid-for list is known, so nothing jumps", () => {
    circle = { data: [CIRCLE_PERSON], isSuccess: true };
    sponsored = { data: undefined, isLoading: true, isPending: true, isError: false };
    render(<SupportingPeopleList locale="en" />);
    expect(screen.queryByText("Mama Eze")).toBeNull();
  });
});
