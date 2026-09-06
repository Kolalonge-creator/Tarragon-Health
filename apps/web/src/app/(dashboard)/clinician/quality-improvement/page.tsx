import { QualityImprovementConsole } from "./quality-improvement-console";

export default function QualityImprovementPage() {
  return (
    <div className="space-y-2">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Quality improvement</h1>
        <p className="text-sm text-charcoal-ink/60">
          The Measure → Identify gap → Intervention → Re-measure loop for a metric below target.
        </p>
      </div>
      <QualityImprovementConsole />
    </div>
  );
}
