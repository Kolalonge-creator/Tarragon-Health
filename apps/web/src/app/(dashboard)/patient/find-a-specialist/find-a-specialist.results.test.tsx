/** @jest-environment jsdom */
/** Design audit P3: results first, optional filters folded, a real "message your care team" action. */
import { render, screen } from "@testing-library/react";

let providers: unknown[] = [];
let loading = false;
let lastArgs: Record<string, unknown> = {};
jest.mock("@/lib/queries/specialist-referrals", () => ({
  useMatchedSpecialistProviders: (args: Record<string, unknown>) => {
    lastArgs = args;
    return { data: providers, isLoading: loading };
  },
}));

import { FindASpecialist } from "./find-a-specialist";

const provider = (id: string, name: string) => ({
  id, name, specialist_type: "cardiology", subspecialty: null, supports_telemedicine: true, city: "Ikeja", state: "Lagos",
  consultation_fee_kobo: 500000, years_of_experience: 8, qualifications: [], clinical_interests: [], languages: [],
});

describe("FindASpecialist", () => {
  beforeEach(() => {
    providers = [provider("1", "Dr A"), provider("2", "Dr B")];
    loading = false;
  });

  it("shows the result count and the results straight away, with the extra filters folded", () => {
    const { container } = render(<FindASpecialist patientLocation={{ state: "Lagos", city: "Ikeja", area: null }} />);
    expect(screen.getByText("2 specialists in cardiology")).not.toBeNull();
    expect(screen.getByText("Dr A")).not.toBeNull();
    const filters = container.querySelector("details") as HTMLDetailsElement;
    expect(filters.open).toBe(false);
    // the patient's own state and city are applied, and the heading says two optional filters are on
    expect(lastArgs.state).toBe("Lagos");
    expect(lastArgs.city).toBe("Ikeja");
    expect(screen.getByText("2 on")).not.toBeNull();
  });

  it("offers a real Message your care team link", () => {
    render(<FindASpecialist />);
    expect(screen.getByRole("link", { name: "Message your care team" }).getAttribute("href")).toBe("/patient/messages");
  });

  it("shows no count when nothing matches", () => {
    providers = [];
    render(<FindASpecialist />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/No specialists match yet/)).not.toBeNull();
  });
});
