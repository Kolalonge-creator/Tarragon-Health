import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default function PatientDashboardPage() {
  return (
    <DashboardShell title="Your health" roleLabel="Patient">
      <div className="rounded-xl border border-brand-navy/10 bg-white p-6">
        <p className="text-sm text-brand-ink/80">
          Your readings, medications, and screening reminders will appear here
          soon.
        </p>
      </div>
    </DashboardShell>
  );
}
