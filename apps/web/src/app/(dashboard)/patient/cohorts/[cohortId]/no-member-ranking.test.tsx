/** @jest-environment jsdom */
/**
 * Acceptance scan (S69c, Part C): a ranking of named or identifiable members must never be rendered, and no challenge view may carry an
 * individual value. Two layers: the rendered screen (names never sit next to a number or inside an ordered list) and the source (no
 * rank, leaderboard or sort-by-effort wording on the cohort screens, web or phone). Sabotage-checked at the bottom: the scanner must flip
 * on a deliberately bad render.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { findShameCopy } from "@tarragon/shared";
import { rosterRowSchema, challengeSchema } from "@/lib/cohorts/model";
import { CohortView } from "./cohort-view";

const COHORT = { cohort_id: "c1", name: "Grace Fellowship Group", kind: "church", state: "active", is_moderator: false, muted: false, contributing: true };
const NAMES = ["Ada", "Chidi", "Ngozi", "Tunde"];
const mockChallenges = [
  { challenge_id: "ch1", label: "Move together", unit: "minutes", starts_on: "2026-10-07", ends_on: "2026-10-20", phase: "active", available: true, contributing: true,
    total: { state: "shown", total: 1810, progress_pct: 60, goal_reached: false, group_size: "10-19", as_of: "2026-10-08", final: false } },
];
function mockNoop() {
  return { mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false, data: undefined, error: null };
}
jest.mock("@/lib/queries/cohorts", () => {
  const actual = jest.requireActual("@/lib/queries/cohorts");
  return {
    ...actual,
    useMyCohorts: () => ({ isPending: false, data: { open: true, off: false, cohorts: [COHORT] } }),
    // a hostile reply: it carries per-member values and ranks, which no screen may show
    useCohortChallenges: () => ({ isPending: false, data: jest.requireActual("@/lib/cohorts/model").parseChallenges(mockChallenges.map((c) => ({ ...c, leaderboard: [{ name: "Ada", value: 912 }], yours: 777, rank: 1 }))) }),
    useRoster: () => ({ data: NAMES.map((n, i) => ({ member_id: `m${i}`, first_name: n, role: i === 0 ? "moderator" : "member", is_you: i === 1 })) }),
    useChallengeSummary: () => ({ data: { available: true, contributing: true, did_today: false, skipped_this_week: false, rest_available: true, weeks_active: 4 } }),
    useEffortHistory: () => ({ data: { weeks_active: 4, challenges: [] } }),
    useModeratorReports: () => ({ data: [] }), useTemplates: () => ({ data: [] }),
    useRestCheckin: mockNoop, useSkipWeek: mockNoop, useCreateInvite: mockNoop, useStartChallenge: mockNoop, useCloseCohort: mockNoop, useRemoveMember: mockNoop,
    useContribute: mockNoop, useTotalsConsent: mockNoop, useMute: mockNoop, useLeave: mockNoop, useReport: mockNoop,
  };
});

/** Returns the reasons the DOM shows a ranking of identifiable members. Empty means clean. */
export function rankingFindings(root: HTMLElement, names: readonly string[]): string[] {
  const found: string[] = [];
  for (const li of Array.from(root.querySelectorAll("li"))) {
    const text = li.textContent ?? "";
    const named = names.find((n) => new RegExp(`\\b${n}\\b`).test(text));
    if (named && /\d/.test(text.replace(/\(you\)/i, ""))) found.push(`a number beside the name ${named}`);
  }
  for (const ol of Array.from(root.querySelectorAll("ol"))) {
    const named = names.find((n) => new RegExp(`\\b${n}\\b`).test(ol.textContent ?? ""));
    if (named) found.push(`an ordered list contains the name ${named}`);
  }
  const all = root.textContent ?? "";
  if (/\b(leaderboard|rank(ed|ing)?|top contributors?|most active|first place|1st|2nd|3rd)\b/i.test(all)) found.push("ranking wording");
  if (/\b(912|777)\b/.test(all)) found.push("an individual value");
  return found;
}

describe("no ranking of named members is ever rendered", () => {
  it("the cohort screen shows names in a plain list with no number, no ordering and no individual value", () => {
    const { container } = render(<CohortView cohortId="c1" locale="en" />);
    expect(container.textContent).toContain("Ada");
    expect(rankingFindings(container, NAMES)).toEqual([]);
    expect(findShameCopy(container.textContent ?? "")).toEqual([]);
  });

  it("the parsed roster and challenge schemas have no field that could carry an individual figure or rank", () => {
    expect(Object.keys(rosterRowSchema.shape).sort()).toEqual(["first_name", "is_you", "member_id", "role"]);
    expect(Object.keys(challengeSchema.shape)).not.toEqual(expect.arrayContaining(["yours"]));
    const keys = Object.keys(challengeSchema.shape).join(" ");
    expect(keys).not.toMatch(/rank|leader|value|mine|yours|member/);
  });

  it("SABOTAGE: the scanner flips on a rendered leaderboard of named members", () => {
    const host = document.createElement("div");
    host.innerHTML = "<ol><li>Ada 912 minutes</li><li>Chidi 700 minutes</li></ol>";
    expect(rankingFindings(host, NAMES).length).toBeGreaterThan(0);
  });
});

describe("source scan: no ranking code on the cohort screens (web and phone)", () => {
  const webDir = join(process.cwd(), "src", "app", "(dashboard)", "patient", "cohorts");
  const files: string[] = [];
  function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
    }
  }
  walk(webDir);
  files.push(join(process.cwd(), "..", "mobile", "src", "screens", "sections", "cohorts-section.tsx"));
  files.push(join(process.cwd(), "..", "mobile", "src", "screens", "sections", "cooperative-views.tsx"));

  it("finds the screens to scan", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((f) => [f.split("/").slice(-2).join("/"), f]))("%s has no leaderboard, rank or sort-by-effort code", (_n, f) => {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/leaderboard|\.rank\b|rank:|dense_rank|topContributors|most_active|mostActive/i);
    expect(src).not.toMatch(/\.(roster|members)\b[^;\n]*\.sort\(|\.sort\([^)]*(effort|value|total|minutes|days)/i);
    expect(src).not.toMatch(/useBoard|loadBoard|cohort_board|BoardPanel|BoardView/);
  });
});
