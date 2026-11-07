/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { NotificationCentre } from "./notification-centre";

type HistoryState = { data?: { pages: { rows: unknown[] }[] }; isLoading: boolean; isError: boolean; hasNextPage?: boolean };
let history: HistoryState;
let acting: { fullName: string | null } | null = null;
const markRead = jest.fn();
const markAll = jest.fn();
jest.mock("@/lib/queries/notifications", () => ({
  useInAppNotificationHistory: () => ({ ...history, fetchNextPage: jest.fn(), isFetchingNextPage: false }),
  useMarkNotificationRead: () => ({ mutate: markRead, isPending: false, isError: false }),
  useMarkAllNotificationsRead: () => ({ mutate: markAll, isPending: false, isError: false }),
}));
jest.mock("@/components/acting-for-context", () => ({ useActingFor: () => acting }));

const n = (id: string, template: string, status = "pending") => ({
  id,
  template,
  status,
  payload: {},
  created_at: "2026-11-01T09:00:00Z",
  priority: "routine",
  response_options: null,
  responded_at: null,
  response_value: null,
});

describe("NotificationCentre", () => {
  beforeEach(() => {
    markRead.mockClear();
    markAll.mockClear();
    acting = null;
    history = {
      data: { pages: [{ rows: [n("1", "appointment_cancelled"), n("2", "new_care_message", "read")] }] },
      isLoading: false,
      isError: false,
    };
  });

  it("lists every notification with the bell's wording and link", () => {
    render(<NotificationCentre />);
    expect(screen.getByText("Your appointment was cancelled").closest("a")?.getAttribute("href")).toBe("/patient/appointments");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("filters by category with aria-pressed", () => {
    render(<NotificationCentre />);
    fireEvent.click(screen.getByRole("button", { name: "Appointments" }));
    expect(screen.getByRole("button", { name: "Appointments" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Payments" }));
    expect(screen.getByText("Nothing in this group yet.")).toBeTruthy();
  });

  it("marks one read, and all shown unread at once", () => {
    render(<NotificationCentre />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    expect(markRead).toHaveBeenCalledWith("1");
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(markAll).toHaveBeenCalledWith(["1"]);
  });

  it("says Couldn't load on a failed read, never No notifications yet", () => {
    history = { data: undefined, isLoading: false, isError: true };
    render(<NotificationCentre />);
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn.t load your notifications/);
    expect(screen.queryByText("No notifications yet.")).toBeNull();
  });

  it("says these are your own notifications while managing someone's account", () => {
    acting = { fullName: "Ngozi Adeyemi" };
    render(<NotificationCentre />);
    expect(screen.getByText(/These are your own notifications\. Ngozi gets theirs/)).toBeTruthy();
  });
});
