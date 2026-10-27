/** @jest-environment jsdom */
/**
 * S67 follow-up (OQ-346): the patient pregnancy screens. Behaviour (kick counter, contraction timer, birth plan, week card, schedule, guard)
 * and an axe pass on every state that renders different markup.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { en } from "@tarragon/i18n";
import { expectNoA11yViolations } from "@/test/a11y";
import { KickCounter } from "./kick-counter";
import { ContractionTimer } from "./contraction-timer";
import { BirthPlanForm } from "./birth-plan-form";
import { WeekCard } from "./week-card";
import { AntenatalSchedule } from "./antenatal-schedule";
import { PregnancyTools } from "./pregnancy-tools";
import { PregnancyDangerCard } from "./pregnancy-danger-card";

const saveKick = jest.fn();
const saveContraction = jest.fn();
const savePlan = jest.fn();
let guardOpen = true;
let weekRows: unknown[] = [];
let visitRows: unknown[] = [];
let planRow: unknown = null;
let kickHistory: unknown[] = [];
let planError = false;

jest.mock("@/lib/queries/growth", () => ({ useMaternalFollowUpOpen: () => ({ data: guardOpen }) }));
jest.mock("@/lib/queries/medications", () => ({ todayIsoDate: () => "2026-10-22" }));
jest.mock("@/lib/queries/pregnancy-tools", () => ({
  useKickHistory: () => ({ data: kickHistory }),
  useSaveKickSession: () => ({ mutate: saveKick, isSuccess: false, isError: false }),
  useSaveContractionSession: () => ({ mutate: saveContraction, isSuccess: false, isError: false }),
  useActivePregnancy: () => ({ data: { id: "preg-1" } }),
  useBirthPlan: () => ({ data: planRow, isPending: false, isError: planError }),
  useSaveBirthPlan: () => ({ mutate: savePlan, isPending: false, isSuccess: false, isError: false }),
  usePregnancyWeekContent: () => ({ data: weekRows }),
  useAntenatalVisits: () => ({ data: visitRows }),
}));

beforeAll(() => {
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "11111111-1111-4111-8111-111111111111" }, configurable: true });
  }
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  guardOpen = true;
  weekRows = [];
  visitRows = [];
  planRow = null;
  kickHistory = [];
  planError = false;
  saveKick.mockReset();
  saveContraction.mockReset();
});
afterEach(() => jest.useRealTimers());

const MIN = 60_000;

describe("baby movement counter", () => {
  function setup(week = 30) {
    let clock = 1_000_000;
    const now = () => clock;
    const view = render(<KickCounter patientId="p1" organisationId="o1" week={week} now={now} />);
    return { ...view, advance: (ms: number) => { clock += ms; }, tick: (ms: number) => act(() => { clock += ms; jest.advanceTimersByTime(ms); }) };
  }

  it("is not offered before the configured week", () => {
    setup(20);
    expect(screen.getByText(en["preg.kick.not_yet"])).toBeTruthy();
    expect(screen.queryByText(en["preg.kick.start"])).toBeNull();
  });

  it("the target number of taps ends the session with the done message and saves it", () => {
    const { advance } = setup();
    fireEvent.click(screen.getByText(en["preg.kick.start"]));
    for (let i = 0; i < 10; i += 1) {
      advance(MIN);
      fireEvent.click(screen.getByText(en["preg.kick.tap"]));
    }
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText(en["preg.kick.done"])).toBeTruthy();
    expect(saveKick).toHaveBeenCalledTimes(1);
    expect(saveKick.mock.calls[0]![0]).toMatchObject({ result: "target_reached", result_reason: null, patient_id: "p1", organisation_id: "o1", week_at_start: 30, source: "patient" });
  });

  it("'I feel less movement than usual' shows the fixed contact-today card at once and saves it", () => {
    setup();
    fireEvent.click(screen.getByText(en["preg.kick.less"]));
    expect(screen.getByTestId("preg-card-contact_today").textContent).toContain(en["preg.card.contact_today.body"]);
    expect(saveKick.mock.calls[0]![0]).toMatchObject({ result: "contact_today", result_reason: "reported_less_movement", reported_less: true });
  });

  it("fewer than the target when the window ends is the fixed card, never reassurance or advice to hold off", () => {
    const { tick } = setup();
    fireEvent.click(screen.getByText(en["preg.kick.start"]));
    fireEvent.click(screen.getByText(en["preg.kick.tap"]));
    tick(121 * MIN);
    const card = screen.getByTestId("preg-card-contact_today");
    expect(card.textContent).not.toMatch(/\bwait\b|tomorrow|fine|normal|nothing to worry/i);
    expect(saveKick.mock.calls[0]![0]).toMatchObject({ result: "contact_today", result_reason: "window_elapsed_without_target" });
  });

  it("stopping early saves a 'stopped' session and shows no clinical card", () => {
    setup();
    fireEvent.click(screen.getByText(en["preg.kick.start"]));
    fireEvent.click(screen.getByText(en["preg.ui.kick.stop"]));
    expect(screen.queryByTestId("preg-card-contact_today")).toBeNull();
    expect(saveKick.mock.calls[0]![0]).toMatchObject({ result: "stopped", result_reason: null });
  });

  it("a failed save still shows the contact-today card, says it was not saved, and a retry sends the same session", () => {
    saveKick.mockImplementation((_row: unknown, opts: { onError: () => void }) => opts.onError());
    setup();
    fireEvent.click(screen.getByText(en["preg.kick.less"]));
    expect(screen.getByTestId("preg-card-contact_today")).toBeTruthy();
    expect(screen.getByText(en["preg.ui.kick.not_saved"])).toBeTruthy();
    fireEvent.click(screen.getByText(en["preg.ui.kick.retry_save"]));
    expect(saveKick).toHaveBeenCalledTimes(2);
    expect(saveKick.mock.calls[1]![0]).toEqual(saveKick.mock.calls[0]![0]);
  });

  it("stopped sessions take no slot in her personal normal (same as the phone)", () => {
    const reached = { result: "target_reached", minutes_to_target: 10, started_at: "2026-10-01T08:00:00Z" };
    const stopped = { result: "stopped", minutes_to_target: null, started_at: "2026-10-02T08:00:00Z" };
    // newest first: four stopped sessions after three that reached the target. If stopped ones took slots she would have no normal.
    kickHistory = [stopped, stopped, stopped, stopped, reached, reached, reached];
    const { tick } = setup();
    fireEvent.click(screen.getByText(en["preg.kick.start"]));
    tick(21 * MIN);
    expect(screen.getByTestId("preg-card-contact_today")).toBeTruthy();
    expect(saveKick.mock.calls[0]![0]).toMatchObject({ result: "contact_today", result_reason: "clear_drop" });
  });

  it("has no accessibility violations while counting and on the card", async () => {
    jest.useRealTimers();
    const { container } = render(<KickCounter patientId="p1" organisationId="o1" week={30} now={() => 1} />);
    fireEvent.click(screen.getByText(en["preg.kick.start"]));
    const { axe } = await import("jest-axe");
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByText(en["preg.kick.less"]));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("contraction timer", () => {
  function setup(week: number, flags = null as null | { longJourney: boolean; previousFastLabour: boolean; previousBirths: number }) {
    let clock = 5_000_000;
    const now = () => clock;
    render(<ContractionTimer patientId="p1" organisationId="o1" week={week} flags={flags} now={now} />);
    function contraction(startOffset: number, seconds: number) {
      clock = 5_000_000 + startOffset;
      fireEvent.click(screen.getByText(en["preg.contractions.start"]));
      clock += seconds * 1000;
      fireEvent.click(screen.getByText(en["preg.contractions.stop"]));
    }
    return { contraction };
  }

  it("5-1-1: a minute-long contraction every 5 minutes for an hour is the go-now card", () => {
    const { contraction } = setup(38);
    for (let i = 0; i < 13; i += 1) contraction(i * 5 * MIN, 60);
    expect(screen.getByTestId("preg-card-go_now")).toBeTruthy();
    expect(saveContraction).toHaveBeenCalledTimes(1);
    expect(saveContraction.mock.calls[0]![0]).toMatchObject({ result: "go_now", result_reason: "pattern", pattern: "standard" });
  });

  it("the go-now card stays when the next contraction starts, and the session is saved once", () => {
    const { contraction } = setup(38);
    for (let i = 0; i < 13; i += 1) contraction(i * 5 * MIN, 60);
    expect(screen.getByTestId("preg-card-go_now")).toBeTruthy();
    fireEvent.click(screen.getByText(en["preg.contractions.start"]));
    expect(screen.getByTestId("preg-card-go_now")).toBeTruthy();
    expect(screen.queryByText(en["preg.contractions.keep"])).toBeNull();
    expect(saveContraction).toHaveBeenCalledTimes(1);
  });

  it("a failed save of a go-now session offers a retry with the same session id", () => {
    saveContraction.mockImplementation((_row: unknown, opts: { onError: () => void }) => opts.onError());
    setup(38);
    fireEvent.click(screen.getByLabelText(en["preg.contractions.sign.fit"]));
    expect(screen.getByTestId("preg-card-go_now")).toBeTruthy();
    fireEvent.click(screen.getByText(en["preg.ui.kick.retry_save"]));
    expect(saveContraction).toHaveBeenCalledTimes(2);
    expect((saveContraction.mock.calls[1]![0] as { client_id: string }).client_id).toBe((saveContraction.mock.calls[0]![0] as { client_id: string }).client_id);
  });

  it("says so when the birth plan could not be read (the standard guide is in use)", () => {
    render(<ContractionTimer patientId="p1" organisationId="o1" week={38} flags={null} planUnavailable now={() => 1} />);
    expect(screen.getByText(en["preg.ui.contractions.plan_unavailable"])).toBeTruthy();
  });

  it("just short of the hour keeps timing, and says keep timing", () => {
    const { contraction } = setup(38);
    for (let i = 0; i < 11; i += 1) contraction(i * 5 * MIN, 60);
    expect(screen.queryByTestId("preg-card-go_now")).toBeNull();
    expect(screen.getByText(en["preg.contractions.keep"])).toBeTruthy();
  });

  it("any instant sign is go now with no timing at all", () => {
    setup(38);
    fireEvent.click(screen.getByLabelText(en["preg.contractions.sign.waters_break"]));
    expect(screen.getByTestId("preg-card-go_now")).toBeTruthy();
    expect(saveContraction.mock.calls[0]![0]).toMatchObject({ result: "go_now", result_reason: "instant_sign", instant_signs: ["waters_break"] });
  });

  it("any contraction before 37 weeks is go now", () => {
    const { contraction } = setup(34);
    contraction(0, 30);
    expect(screen.getByTestId("preg-card-go_now")).toBeTruthy();
    expect(saveContraction.mock.calls[0]![0]).toMatchObject({ result_reason: "before_term" });
  });

  it("the birth plan's earlier pattern is used (7-1-1): contractions 6 minutes apart reach go now", () => {
    const { contraction } = setup(38, { longJourney: true, previousFastLabour: false, previousBirths: 0 });
    for (let i = 0; i < 11; i += 1) contraction(i * 6 * MIN, 60);
    expect(screen.getByTestId("preg-card-go_now")).toBeTruthy();
    expect(saveContraction.mock.calls[0]![0]).toMatchObject({ pattern: "earlier" });
  });

  it("asks for a due date instead of guessing when the week is unknown", () => {
    render(<ContractionTimer patientId="p1" organisationId="o1" week={null} flags={null} />);
    expect(screen.getByText(en["preg.contractions.needs_due_date"])).toBeTruthy();
  });

  it("has no accessibility violations (idle and on the go-now card)", async () => {
    jest.useRealTimers();
    const { container } = render(<ContractionTimer patientId="p1" organisationId="o1" week={38} flags={null} now={() => 1} />);
    const { axe } = await import("jest-axe");
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByLabelText(en["preg.contractions.sign.fit"]));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("birth plan", () => {
  function fill(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  it("saves a naira note as kobo and E.164 phones; there is no wallet field", () => {
    render(<BirthPlanForm patientId="p1" organisationId="o1" pregnancyId="preg-1" />);
    fill(en["preg.plan.place"], "General Hospital");
    fill(en["preg.plan.money"], "50,000");
    fireEvent.change(document.getElementById("bp-escort-phone")!, { target: { value: "+234 803 123 4567" } });
    fireEvent.click(screen.getByLabelText(en["preg.plan.long_journey"]));
    fireEvent.click(screen.getByText(en["preg.ui.plan.save"]));
    expect(savePlan).toHaveBeenCalledTimes(1);
    const arg = savePlan.mock.calls[0]![0] as { plan: Record<string, unknown>; pregnancyId: string };
    expect(arg.pregnancyId).toBe("preg-1");
    expect(arg.plan).toMatchObject({ place_of_birth: "General Hospital", money_plan_kobo: 5_000_000, escort_phone: "+2348031234567", long_journey: true });
    expect(Object.keys(arg.plan).some((k) => /balance|wallet|topup/i.test(k))).toBe(false);
  });

  it("keeps the money note already saved instead of writing null over it", () => {
    planRow = { place_of_birth: "A", transport_plan: null, money_plan_kobo: null, money_plan_note: "from the clinic", blood_donor_name: null, blood_donor_phone: null, escort_name: null, escort_phone: null, long_journey: false, previous_fast_labour: false, previous_births: 0 };
    render(<BirthPlanForm patientId="p1" organisationId="o1" pregnancyId="preg-1" />);
    fireEvent.click(screen.getByText(en["preg.ui.plan.save"]));
    expect((savePlan.mock.calls[0]![0] as { plan: { money_plan_note: string | null } }).plan.money_plan_note).toBe("from the clinic");
  });

  it("refuses a local phone number and a non-numeric amount, and saves nothing", () => {
    render(<BirthPlanForm patientId="p1" organisationId="o1" pregnancyId="preg-1" />);
    fill(en["preg.plan.money"], "ten thousand");
    fireEvent.change(document.getElementById("bp-donor-phone")!, { target: { value: "08031234567" } });
    fireEvent.click(screen.getByText(en["preg.ui.plan.save"]));
    expect(savePlan).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBe(2);
  });

  it("opens only once a pregnancy is recorded", () => {
    render(<BirthPlanForm patientId="p1" organisationId="o1" pregnancyId={null} />);
    expect(screen.getByText(en["preg.ui.plan.no_pregnancy"])).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    jest.useRealTimers();
    await expectNoA11yViolations(<BirthPlanForm patientId="p1" organisationId="o1" pregnancyId="preg-1" />);
  });
});

describe("week card", () => {
  it("shows the calm coming-soon line when nothing is reviewed, and never a draft", async () => {
    weekRows = [{ kind: "week", week: 30, title: "Draft", body_text: "invented text", review_state: "draft_pending_cmo", version: 1 }];
    jest.useRealTimers();
    await expectNoA11yViolations(<WeekCard week={30} />);
    expect(screen.getByText(en["preg.ui.week.coming_soon"])).toBeTruthy();
    expect(screen.queryByText("invented text")).toBeNull();
  });

  it("shows a reviewed row", () => {
    weekRows = [{ kind: "week", week: 30, title: "Reviewed title", body_text: "Reviewed body", review_state: "cmo_reviewed", version: 1 }];
    render(<WeekCard week={30} />);
    expect(screen.getByText("Reviewed title")).toBeTruthy();
    expect(screen.queryByText(en["preg.ui.week.coming_soon"])).toBeNull();
  });
});

describe("antenatal schedule", () => {
  it("lists generated visits with plain words, invents no 'missed', and passes axe", async () => {
    visitRows = [
      { id: "a", visit_number: 1, target_week: 12, gestational_week_at_visit: null, status: "completed", appointment_id: null },
      { id: "b", visit_number: 2, target_week: 20, gestational_week_at_visit: null, status: "scheduled", appointment_id: null },
      { id: "c", visit_number: 3, target_week: 26, gestational_week_at_visit: null, status: "scheduled", appointment_id: "appt-1" },
    ];
    jest.useRealTimers();
    await expectNoA11yViolations(<AntenatalSchedule patientId="p1" />);
    expect(screen.getByText(en["preg.ui.schedule.status_completed"])).toBeTruthy();
    expect(screen.getByText(en["preg.ui.schedule.status_scheduled"])).toBeTruthy();
    expect(screen.getByText(en["preg.ui.schedule.booked"])).toBeTruthy();
    expect(screen.queryByText(en["preg.ui.schedule.status_missed"])).toBeNull();
  });
});

describe("the go-live guard (maternal_enabled)", () => {
  const props = { patientId: "p1", organisationId: "o1", lmp: null, edd: "2027-01-10", today: "2026-10-22" };

  it("shows nothing at all while the guard is closed", () => {
    guardOpen = false;
    const { container } = render(<><PregnancyTools {...props} /><PregnancyDangerCard /></>);
    expect(container.textContent).toBe("");
  });

  it("shows every tool once the guard is open", () => {
    render(<PregnancyTools {...props} />);
    expect(screen.getByText(en["preg.ui.section_title"])).toBeTruthy();
    expect(screen.getByText(en["preg.kick.title"])).toBeTruthy();
    expect(screen.getByText(en["preg.contractions.title"])).toBeTruthy();
    expect(screen.getByText(en["preg.plan.title"])).toBeTruthy();
    expect(screen.getByText(en["preg.ui.schedule.title"])).toBeTruthy();
    expect(screen.getByText(en["preg.ui.week.title"])).toBeTruthy();
  });

  it("the danger card lists the signs and the action, and passes axe", async () => {
    jest.useRealTimers();
    await expectNoA11yViolations(<PregnancyDangerCard />);
    expect(screen.getByText(en["preg.ui.offline.action"])).toBeTruthy();
  });
});
