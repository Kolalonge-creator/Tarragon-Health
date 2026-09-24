/** @jest-environment jsdom */
/**
 * ProfileCard's `status` used to be seeded once from `profile?.status` in a
 * `useState` initializer — fine on the very first render (before the async
 * query resolves, `profile` is `undefined`), but ProfileCard never unmounts
 * across the loading -> loaded transition (SmokingClient renders it
 * unconditionally), so that seed froze at "never" and never picked up the
 * real saved status. A returning "current"/"former" smoker who clicked
 * Update saw the dropdown defaulting to "never", hiding the cigarettes/day
 * field their real status implies, and silently reverting their saved
 * status to "never" if they saved without touching the dropdown. Found
 * during the 2026-09-24 patient-dashboard audit's /code-review ultra pass.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfileCard } from "./smoking-client";

function withQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

jest.mock("./actions", () => ({
  setSmokingProfileAction: jest.fn(async () => ({ success: true })),
}));

// Pulled in by smoking-client.tsx but irrelevant to this test; its own
// action module imports next/cache's revalidatePath, which chokes under
// jsdom on TextEncoder not being defined.
jest.mock("@/components/lifestyle-barrier-picker", () => ({
  LifestyleBarrierPicker: () => null,
}));

describe("ProfileCard (smoking status)", () => {
  it("shows the real saved status, not a stale 'never', once the query resolves after Update is clicked", () => {
    const { rerender } = render(
      withQueryClient(<ProfileCard patientId="patient-1" profile={undefined} isLoading={true} />)
    );

    // The query resolves: a returning patient whose real status is "current".
    rerender(
      withQueryClient(
        <ProfileCard
          patientId="patient-1"
          profile={{
            id: "profile-1",
            organisation_id: "org-1",
            patient_id: "patient-1",
            created_at: "2026-09-01T00:00:00Z",
            updated_at: "2026-09-01T00:00:00Z",
            status: "current",
            cigarettes_per_day: 12,
            years_smoking: 5,
            quit_date: null,
            quit_motivation: null,
          }}
          isLoading={false}
        />
      )
    );

    // Read-only summary first, matching the saved status.
    expect(screen.getByText("Current smoker")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    // The edit form's Status select must reflect "current", not the stale
    // "never" the old useState initializer would have frozen on — proven by
    // the cigarettes/day field only rendering when status === "current".
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("current");
    expect(screen.getByLabelText("Cigarettes per day")).not.toBeNull();
  });
});
