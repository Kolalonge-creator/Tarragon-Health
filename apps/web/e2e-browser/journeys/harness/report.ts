// S85 journey harness: write the step report where CI and a human can read it.
//
// One JSON file per journey under test-results/journeys/, a printed text report, and a Playwright attachment. finish() throws
// when any step failed so the test fails, and otherwise returns the report; a journey with pending steps is returned with
// verdict "incomplete" and is never presented as passing.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestInfo } from "@playwright/test";
import { JourneyRun, renderReport, type JourneyReport } from "../../../../../packages/shared/src/journeys/steps";

export const REPORT_DIR = join(process.cwd(), "test-results", "journeys");

export async function finishJourney(run: JourneyRun, testInfo?: TestInfo): Promise<JourneyReport> {
  const report = run.report();
  const text = renderReport(report);
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, `${report.journey}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(REPORT_DIR, `${report.journey}.txt`), text + "\n");
  console.log("\n" + text + "\n");
  if (testInfo) {
    await testInfo.attach(`journey-${report.journey}-report`, { body: text, contentType: "text/plain" });
  }
  if (report.verdict === "failed") {
    const failed = report.steps.filter((s) => s.result.status === "failed").map((s) => `${s.id}: ${(s.result as { reason: string }).reason}`);
    throw new Error(`journey ${report.journey} has failing steps:\n  ${failed.join("\n  ")}`);
  }
  return report;
}
