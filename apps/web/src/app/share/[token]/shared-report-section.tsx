import { HealthReportView } from "@/components/health-report-view";
import { buildSharedReportModel, type SharedReportBody } from "@/lib/health-report/render-model";

/** The shared yearly report on a public link (S46d). Loaded lazily by shared-record-view.tsx so other links do not carry the report renderer. */
export function SharedReportSection({ body }: { body: SharedReportBody }) {
  return <HealthReportView model={buildSharedReportModel(body)} />;
}
