import { ClinicianMessagesWorklist } from "./worklist";

export default function ClinicianMessagesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Patient messages</h1>
        <p className="text-sm text-charcoal-ink/60">
          In-app care messaging threads with your patients.
        </p>
      </div>
      <ClinicianMessagesWorklist />
    </div>
  );
}
