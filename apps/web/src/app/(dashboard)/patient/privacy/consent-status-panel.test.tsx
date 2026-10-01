/** @jest-environment jsdom */
/**
 * ConsentStatusPanel is the only place an already-onboarded patient can
 * close an outstanding-consent gap (onboarding's own ConsentStep never runs
 * again). This covers: the status list distinguishing "never accepted" from
 * "accepted an older version, now stale"; the review prompt appearing only
 * when something is outstanding; and that reviewing scopes ConsentStep to
 * ONLY the outstanding types, never re-showing (or re-recording) a type the
 * patient is already current on.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConsentStatusPanel } from "./consent-status-panel";

const invalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const CURRENT_VERSIONS = [
  {
    id: "v-dp-2",
    consent_type: "data_processing",
    version: 2,
    title: "Data processing",
    body: "## Why\nWe use your data to provide care.",
  },
  {
    id: "v-tos-1",
    consent_type: "terms_of_service",
    version: 1,
    title: "Terms of service",
    body: "## Terms\nStandard terms apply.",
  },
];

// data_processing accepted at v1 (stale — current is v2). terms_of_service
// accepted at the current v1.
const ROW = { action: "accepted", created_at: "2026-01-01T00:00:00Z", accepted_at: "2026-01-01T00:00:00Z" };
// Mutable so a test can add a withdrawal or an optional purpose.
let ACCEPTED: Record<string, unknown>[] = [
  { id: "c1", consent_type: "data_processing", version: 1, ...ROW },
  { id: "c2", consent_type: "terms_of_service", version: 1, ...ROW },
];
let EXTRA_VERSIONS: Record<string, unknown>[] = [];

jest.mock("@/lib/queries/consent", () => {
  const actual = jest.requireActual("@/lib/queries/consent");
  return {
    ...actual,
    useCurrentConsentVersions: () => ({ data: CURRENT_VERSIONS, isLoading: false }),
    useOutstandingConsentTypes: () => ({
      versions: [...CURRENT_VERSIONS, ...EXTRA_VERSIONS],
      accepted: ACCEPTED,
      outstanding: CURRENT_VERSIONS.filter((v) => v.consent_type === "data_processing"),
      isLoading: false,
    }),
  };
});

const withdrawMock = jest.fn();
jest.mock("./consent-actions", () => ({ withdrawConsentAction: (...a: unknown[]) => withdrawMock(...a) }));

let capturedFormData: FormData | null = null;
jest.mock("@/app/onboarding/actions", () => ({
  acceptConsents: jest.fn(async (_prevState: unknown, formData: FormData) => {
    capturedFormData = formData;
    return { success: true };
  }),
}));

describe("ConsentStatusPanel", () => {
  beforeEach(() => {
    capturedFormData = null;
    invalidateQueries.mockReset();
    withdrawMock.mockReset().mockResolvedValue({ success: true });
    EXTRA_VERSIONS = [];
    ACCEPTED = [
      { id: "c1", consent_type: "data_processing", version: 1, ...ROW },
      { id: "c2", consent_type: "terms_of_service", version: 1, ...ROW },
    ];
  });

  it("labels a stale (older-version) consent differently from a never-accepted one", () => {
    render(<ConsentStatusPanel patientId="patient-1" />);
    expect(screen.getByText("A newer version is available — review needed")).toBeTruthy();
    expect(screen.getByText(/Accepted 1 Jan 2026/)).toBeTruthy();
  });

  it("shows a review prompt naming the one outstanding item", () => {
    render(<ConsentStatusPanel patientId="patient-1" />);
    expect(screen.getByText("One consent item needs your review.")).toBeTruthy();
  });

  it("scopes the review step to only the outstanding type, and records only that type on submit", async () => {
    render(<ConsentStatusPanel patientId="patient-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Review and accept" }));

    // Only the outstanding consent's text is shown for review — the
    // already-current terms_of_service must not reappear a second time
    // inside the review step (one "Terms of service" from the status list
    // above is expected; a second, from ConsentStep's own rendering, is not).
    expect(screen.getAllByText("Data processing").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Terms of service")).toHaveLength(1);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /I agree, continue/ }));

    // onComplete fires (setReviewing(false)) once the mocked action resolves,
    // which un-mounts the review form's checkbox.
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());

    expect(capturedFormData).not.toBeNull();
    const fd = capturedFormData as FormData;
    expect(fd.getAll("onlyTypes")).toEqual(["data_processing"]);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["patient-consents", "patient-1"],
    });
  });

  it("lets the patient back out of reviewing without submitting anything", () => {
    render(<ConsentStatusPanel patientId="patient-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Review and accept" }));
    expect(screen.getByRole("checkbox")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(capturedFormData).toBeNull();
  });

  it("shows a withdrawn consent as Withdrawn, not Accepted (it used to read as accepted)", () => {
    ACCEPTED = [
      ...ACCEPTED,
      { id: "c3", consent_type: "terms_of_service", version: 1, action: "withdrawn", created_at: "2026-02-01T00:00:00Z", accepted_at: "2026-02-01T00:00:00Z" },
    ];
    render(<ConsentStatusPanel patientId="patient-1" />);
    expect(screen.getByText("Withdrawn")).toBeTruthy();
    expect(screen.getByText(/You withdrew this/)).toBeTruthy();
  });

  it("lists the history, newest first, with withdrawals as well as acceptances", () => {
    ACCEPTED = [
      ...ACCEPTED,
      { id: "c3", consent_type: "terms_of_service", version: 1, action: "withdrawn", created_at: "2026-02-01T00:00:00Z", accepted_at: "2026-02-01T00:00:00Z" },
    ];
    render(<ConsentStatusPanel patientId="patient-1" />);
    const items = screen.getAllByText(/Withdrew|Accepted .* v/).map((n) => n.textContent ?? "");
    expect(items.some((t) => /Withdrew Terms of service/.test(t))).toBe(true);
    expect(items.some((t) => /Accepted Data processing/.test(t))).toBe(true);
  });

  it("withdrawing an optional purpose takes two taps and calls the action once", async () => {
    EXTRA_VERSIONS = [{ id: "v-r-1", consent_type: "research", version: 1, is_required: false }];
    ACCEPTED = [...ACCEPTED, { id: "c9", consent_type: "research", version: 1, ...ROW }];
    render(<ConsentStatusPanel patientId="patient-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(withdrawMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, withdraw" }));
    await waitFor(() => expect(withdrawMock).toHaveBeenCalledWith("research"));
    expect(withdrawMock).toHaveBeenCalledTimes(1);
  });

  it("offers no withdraw button for a required purpose", () => {
    render(<ConsentStatusPanel patientId="patient-1" />);
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });
});
