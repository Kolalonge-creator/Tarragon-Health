/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import { nextActionView, figure, type HomeEscalation } from "@tarragon/shared";
import { NextActionHero } from "./next-action-hero";
import { TodayStrip } from "./today-strip";

const NOW = new Date("2026-10-30T10:00:00Z");

const emergency: HomeEscalation = {
  id: "e1",
  reason: "BP 210/130 with headache",
  status: "open",
  patientName: "Ada Obi",
  level: "emergency",
  dueAt: "2026-10-30T09:30:00Z",
  assignedDoctorId: null,
};

describe("NextActionHero", () => {
  it("a failed load says it could not load and never says nothing is open", () => {
    const html = renderToStaticMarkup(<NextActionHero view={nextActionView([], true, NOW)} />);
    expect(html).toContain("could not be loaded");
    expect(html).not.toContain("No open escalations");
  });

  it("an empty successful load is the clear state", () => {
    const html = renderToStaticMarkup(<NextActionHero view={nextActionView([], false, NOW)} />);
    expect(html).toContain("No open escalations");
  });

  it("shows the patient, the reason, the overdue countdown and a link to the case", () => {
    const html = renderToStaticMarkup(<NextActionHero view={nextActionView([emergency], false, NOW)} />);
    expect(html).toContain("Ada Obi");
    expect(html).toContain("BP 210/130 with headache");
    expect(html).toContain("Overdue by 30 min");
    expect(html).toContain('href="/clinician/escalations/e1"');
  });

  it("says how many more cases wait behind it", () => {
    const other: HomeEscalation = { ...emergency, id: "e2", level: "routine" };
    const html = renderToStaticMarkup(<NextActionHero view={nextActionView([other, emergency], false, NOW)} />);
    expect(html).toContain("1 more case waiting");
  });
});

describe("TodayStrip", () => {
  const tiles = (count: ReturnType<typeof figure>) => [
    { label: "Notes to complete", figure: count, href: "/clinician/patients", note: "to sign" },
  ];

  it("an unknown count is never drawn as zero", () => {
    const html = renderToStaticMarkup(<TodayStrip tiles={tiles(figure(0, true))} />);
    expect(html).toContain("Could not be loaded");
    expect(html).not.toMatch(/>0</);
  });

  it("a known zero is drawn as 0", () => {
    const html = renderToStaticMarkup(<TodayStrip tiles={tiles(figure(0, false))} />);
    expect(html).toMatch(/>0</);
    expect(html).not.toContain("Could not be loaded");
  });
});
