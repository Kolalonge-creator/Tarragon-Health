/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { SectionUnavailable } from "./section-unavailable";
import { ContractStatusCard } from "@/components/contract-status-card";
import { MedicationOutcomesCard } from "@/components/medication-outcomes-card";
import { EngagementOutcomesCard } from "@/components/engagement-outcomes-card";
import { VaccinationCoveragePanel } from "@/app/(dashboard)/dashboard/corporate/vaccination-coverage-panel";
import { ActivationFunnelCard, DepartmentBreakdownTable } from "@/app/(dashboard)/dashboard/corporate/activation-funnel-card";
import { AgeBandSummary } from "@/app/(dashboard)/dashboard/corporate/age-band-summary";
import { CareGapPanel } from "@/app/(dashboard)/dashboard/hmo/care-gap-panel";

describe("SectionUnavailable", () => {
  it("names the section and says the figures are unknown, as an alert", () => {
    render(<SectionUnavailable title="Care gaps" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Care gaps could not be loaded");
    expect(alert.textContent).toContain("unknown, not zero");
  });
});

describe("a failed read replaces the card, it does not render as nothing or zero", () => {
  const cases: [string, (failed: boolean) => React.ReactElement][] = [
    ["Contract status", (failed) => <ContractStatusCard performance={null} failed={failed} />],
    ["Medication and control outcomes", (failed) => <MedicationOutcomesCard outcomes={null} failed={failed} />],
    ["Engagement and BP control", (failed) => <EngagementOutcomesCard buckets={null} failed={failed} />],
    ["Vaccination coverage", (failed) => <VaccinationCoveragePanel coverage={null} failed={failed} />],
    ["Workforce activation", (failed) => <ActivationFunnelCard funnel={null} failed={failed} />],
    ["Activation by department", (failed) => <DepartmentBreakdownTable rows={[]} failed={failed} />],
    ["Age segmentation", (failed) => <AgeBandSummary distribution={null} failed={failed} />],
    ["Care gaps", (failed) => <CareGapPanel summary={null} failed={failed} />],
  ];

  it.each(cases)("%s says it could not be loaded", (title, make) => {
    const { container } = render(make(true));
    expect(screen.getByRole("alert").textContent).toContain(`${title} could not be loaded`);
    expect(container.textContent).not.toContain("Not enough eligible staff");
  });

  it.each(cases)("%s raises no alert when the read worked and there is nothing to show", (_title, make) => {
    const { container } = render(make(false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent ?? "").not.toContain("could not be loaded");
  });

  it("the funnel keeps its own 'not enough people' wording for a genuine null", () => {
    render(<ActivationFunnelCard funnel={null} />);
    expect(screen.getByText(/Not enough eligible staff yet/)).toBeTruthy();
  });
});
