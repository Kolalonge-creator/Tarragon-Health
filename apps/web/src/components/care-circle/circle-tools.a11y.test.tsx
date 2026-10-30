/** @jest-environment jsdom */
/**
 * Care Circle supporter tools (S69b): the shared jobs, the weekly digest and the nudge list. Each renders nothing while its module is
 * off, shows only what the database sent, has no free-text field and no chat, and is axe-clean.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CircleTasksPanel } from "./circle-tasks-panel";
import { NudgesCard } from "./nudges-card";
import { WeeklyDigestCard } from "./weekly-digest-card";

let tools: { digest: boolean; tasks: boolean; missed_dose: boolean; grace_minutes: number | null };
let tasks: { isPending: boolean; isError: boolean; data: unknown };
let digest: { isPending: boolean; isError: boolean; data: unknown };
let nudges: { data: unknown[] };
const action = jest.fn();
const post = jest.fn();
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock("@/lib/queries/care-circle", () => {
  const actual = jest.requireActual("@/lib/queries/care-circle");
  return {
    ...actual,
    useToolsStatus: () => ({ data: tools }),
    useCircleTasks: () => tasks,
    useTaskAction: () => ({ mutateAsync: action, isPending: false }),
    usePostTask: () => ({ mutateAsync: post, isPending: false }),
    useWeeklyDigest: () => digest,
    useRecentNudges: () => nudges,
  };
});

const TASK = { task_id: "t1", kind: "take_to_lab", needed_by: "2026-10-27", state: "open", claimed_by_name: null, mine: false, posted_by_me: false, can_claim: true, can_release: false, can_complete: false, can_cancel: false };

beforeEach(() => {
  tools = { digest: true, tasks: true, missed_dose: true, grace_minutes: 30 };
  tasks = { isPending: false, isError: false, data: { role: "helper", tasks: [TASK] } };
  digest = { isPending: false, isError: false, data: { patient_id: "p", name: "Mum", from: "2026-10-16", to: "2026-10-22", days: 7, readings: { days_logged: 5 } } };
  nudges = { data: [{ patient_id: "p", name: "Mum", since: "2026-10-22T08:00:00Z" }] };
  action.mockReset();
  post.mockReset();
});

describe("CircleTasksPanel", () => {
  it("renders nothing while the module is off", () => {
    tools = { ...tools, tasks: false };
    const { container } = render(<CircleTasksPanel patientId="p" locale="en" />);
    expect(container.textContent).toBe("");
  });

  it("lists a job by its fixed kind, lets a helper claim it, and has no free-text field", async () => {
    action.mockResolvedValue(true);
    render(<CircleTasksPanel patientId="p" locale="en" />);
    expect(document.querySelector("li p.font-medium")?.textContent).toBe("A lift to the lab");
    expect(document.querySelectorAll("textarea, input[type=text]")).toHaveLength(0);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I will do this" })));
    expect(action).toHaveBeenCalledWith({ action: "claim_circle_task", taskId: "t1" });
    cleanup();
    await expectNoA11yViolations(<CircleTasksPanel patientId="p" locale="en" />);
  });

  it("says so plainly when someone else got there first", async () => {
    action.mockResolvedValue(false);
    render(<CircleTasksPanel patientId="p" locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I will do this" })));
    expect(screen.getByRole("alert").textContent).toMatch(/Someone already took this one/);
  });

  it("a supporter who can only see reads the list and has neither a claim button nor an add form", () => {
    tasks = { isPending: false, isError: false, data: { role: "viewer", tasks: [{ ...TASK, can_claim: false }] } };
    render(<CircleTasksPanel patientId="p" locale="en" />);
    expect(screen.getByText(/needs the Can see and help setting/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I will do this" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add job" })).toBeNull();
  });

  it("the patient adds a job from the fixed list with an optional date", async () => {
    post.mockResolvedValue(undefined);
    tasks = { isPending: false, isError: false, data: { role: "patient", tasks: [] } };
    render(<CircleTasksPanel patientId="p" locale="en" />);
    fireEvent.change(screen.getByLabelText("What is it?"), { target: { value: "collect_medicines" } });
    fireEvent.change(screen.getByLabelText("Needed by (optional)"), { target: { value: "2026-10-30" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add job" })));
    expect(post).toHaveBeenCalledWith({ kind: "collect_medicines", neededBy: "2026-10-30" });
    cleanup();
    await expectNoA11yViolations(<CircleTasksPanel patientId="p" locale="en" />);
  });

  it("shows the limit in plain words", async () => {
    const { CircleError } = jest.requireActual("@/lib/queries/care-circle");
    post.mockRejectedValue(new CircleError("task_limit"));
    tasks = { isPending: false, isError: false, data: { role: "patient", tasks: [] } };
    render(<CircleTasksPanel patientId="p" locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add job" })));
    expect(screen.getByRole("alert").textContent).toMatch(/as many open jobs as allowed/);
  });
});

describe("WeeklyDigestCard", () => {
  it("renders nothing while the module is off", () => {
    tools = { ...tools, digest: false };
    const { container } = render(<WeeklyDigestCard patientId="p" locale="en" />);
    expect(container.textContent).toBe("");
  });

  it("says days only, for the blocks present, and nothing about a block that is absent", async () => {
    render(<WeeklyDigestCard patientId="p" locale="en" />);
    expect(screen.getByText("Mum logged readings on 5 of 7 days.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/medicines on|Next appointment|mmHg|\d{2,3}\/\d{2,3}/);
    cleanup();
    await expectNoA11yViolations(<WeeklyDigestCard patientId="p" locale="en" />);
  });

  it("says there is nothing to show rather than inventing a line", () => {
    digest = { isPending: false, isError: false, data: { patient_id: "p", name: "Mum", from: "a", to: "b", days: 7 } };
    render(<WeeklyDigestCard patientId="p" locale="en" />);
    expect(screen.getByText("Nothing to show this week.")).toBeTruthy();
  });
});

describe("NudgesCard", () => {
  it("shows a first name and a friendly line, nothing about doses", async () => {
    render(<NudgesCard locale="en" />);
    expect(screen.getByRole("link", { name: "Mum may like to hear from you." }).getAttribute("href")).toBe("/patient/supporting/circle/p");
    expect(document.body.textContent).not.toMatch(/dose|medicine|missed/i);
    cleanup();
    await expectNoA11yViolations(<NudgesCard locale="en" />);
  });

  it("renders nothing while the module is off or when there is nobody", () => {
    tools = { ...tools, missed_dose: false };
    const a = render(<NudgesCard locale="en" />);
    expect(a.container.textContent).toBe("");
    a.unmount();
    tools = { ...tools, missed_dose: true };
    nudges = { data: [] };
    const b = render(<NudgesCard locale="en" />);
    expect(b.container.textContent).toBe("");
  });
});
