/** @jest-environment jsdom */
/**
 * Accessibility regression coverage for NotificationPreferencesForm
 * (/patient/settings/notifications) — every category's Email/Push
 * role="switch" toggles, plus the "Saving…"/"Saved" status text that
 * appears after a toggle (see the fix applied alongside this test: that
 * text previously updated with no aria-live announcement).
 */
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import { NotificationPreferencesForm } from "./notification-preferences-form";

const mutate = jest.fn();
let isPending = false;
jest.mock("@/lib/queries/notification-preferences", () => {
  const actual = jest.requireActual("@/lib/queries/notification-preferences");
  return {
    ...actual,
    useNotificationPreferences: () => ({ data: [], isLoading: false }),
    useUpdateNotificationPreference: () => ({
      mutate,
      get isPending() {
        return isPending;
      },
      variables: undefined,
    }),
  };
});

describe("NotificationPreferencesForm accessibility", () => {
  beforeEach(() => {
    mutate.mockReset();
    isPending = false;
  });

  it("has no axe violations across every notification category", async () => {
    await expectNoA11yViolations(
      <NotificationPreferencesForm patientId="patient-1" organisationId="org-1" />
    );
  });

  it("has no axe violations, and announces the outcome, once a toggle finishes saving", async () => {
    mutate.mockImplementation((_vars, { onSuccess }: { onSuccess: () => void }) => onSuccess());
    const { container } = await expectNoA11yViolations(
      <NotificationPreferencesForm patientId="patient-1" organisationId="org-1" />
    );
    fireEvent.click(screen.getAllByRole("switch", { name: "Email" })[0]!);
    const saved = await screen.findByText("Saved");
    expect(saved.closest('[role="status"]')).not.toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
