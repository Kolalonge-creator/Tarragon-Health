/** @jest-environment jsdom */
/**
 * Patient dashboard 2.0 Home pieces (PD-03, PD-05): the status strip shows only real counts and leaves out failed reads; the next
 * appointment card offers Join only inside the join window and says so when its read failed; the care journey always shows words
 * beside each chip; the fold mounts its contents only once opened.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { HomeStatusStrip } from "./home-status-strip";
import { NextAppointmentCard } from "./next-appointment-card";
import { CareJourneyCard } from "./care-journey-card";
import { LazyFold } from "./lazy-fold";
import { buildCareJourney } from "@/lib/patient/care-journey";
import type { HomeOverview, NextAppointment } from "@/lib/patient/home-overview";

jest.mock("@/lib/patient/home-overview", () => ({}));

const NOW = new Date("2026-11-10T10:00:00Z");
const journey = buildCareJourney({
  isMember: false,
  assessmentDone: true,
  baselineState: "none",
  carePlanActive: false,
  openTestCount: 1,
  resultedTestCount: 0,
  resultsAwaitingDoctor: 0,
  resultsReviewed: 0,
  recentReading: false,
  anyReading: true,
});
const appt = (minutesFromNow: number, status = "confirmed"): NextAppointment => ({
  id: "a1",
  scheduledFor: new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString(),
  appointmentType: "telemedicine",
  status,
  consultationMethod: "telemedicine",
  location: null,
  clinicianName: "Dr. Chidinma Eze",
});

describe("HomeStatusStrip", () => {
  const base: HomeOverview = { actionsDue: 2, resultsAwaitingDoctor: 1, nextAppointment: appt(60 * 24), unreadCareTeamReply: true, journey };

  it("shows each real item with a link", () => {
    render(<HomeStatusStrip overview={base} />);
    expect(screen.getByText("2 actions due")).toBeTruthy();
    expect(screen.getByText("1 result waiting for a doctor")).toBeTruthy();
    expect(screen.getByText(/Next appointment/)).toBeTruthy();
    expect(screen.getByText("New reply from your care team")).toBeTruthy();
  });

  it("leaves out failed reads instead of showing zero, and hides itself when nothing is left", () => {
    const { container } = render(
      <HomeStatusStrip overview={{ ...base, actionsDue: null, resultsAwaitingDoctor: null, nextAppointment: undefined, unreadCareTeamReply: null }} />,
    );
    expect(container.textContent).toBe("");
  });

  it("says nothing is due rather than '0 actions due'", () => {
    render(<HomeStatusStrip overview={{ ...base, actionsDue: 0 }} />);
    expect(screen.getByText("Nothing due today")).toBeTruthy();
  });
});

describe("NextAppointmentCard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it("does not offer Join a day before, and says when joining opens", () => {
    render(<NextAppointmentCard appointment={appt(60 * 24)} />);
    expect(screen.queryByText("Join consultation")).toBeNull();
    expect(screen.getByText(/You can join from/)).toBeTruthy();
    expect(screen.getByText(/Dr. Chidinma Eze/)).toBeTruthy();
  });

  it("offers Join inside the window", () => {
    render(<NextAppointmentCard appointment={appt(5)} />);
    expect(screen.getByText("Join consultation")).toBeTruthy();
  });

  it("says the read failed instead of showing nothing", () => {
    render(<NextAppointmentCard appointment={undefined} />);
    expect(screen.getByText(/could not load your appointments/)).toBeTruthy();
  });

  it("renders nothing when there is no appointment", () => {
    const { container } = render(<NextAppointmentCard appointment={null} />);
    expect(container.textContent).toBe("");
  });
});

describe("CareJourneyCard", () => {
  it("lists six stages, each with a word label, with no axe violations", async () => {
    await expectNoA11yViolations(<CareJourneyCard stages={journey} />);
    const items = screen.getByTestId("care-journey").querySelectorAll("li");
    expect(items).toHaveLength(6);
    expect(screen.getAllByText("Membership")).toHaveLength(3);
  });
});

describe("LazyFold", () => {
  it("mounts its contents only after it is first opened", () => {
    const { container } = render(
      <LazyFold title="More about your health">
        <p>Inside</p>
      </LazyFold>,
    );
    expect(screen.queryByText("Inside")).toBeNull();
    const details = container.querySelector("details")!;
    act(() => {
      details.open = true;
      fireEvent(details, new Event("toggle"));
    });
    expect(screen.getByText("Inside")).toBeTruthy();
  });
});
