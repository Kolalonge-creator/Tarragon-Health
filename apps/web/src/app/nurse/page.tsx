import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default function NurseDashboardPage() {
  return (
    <DashboardShell title="Nurse worklist" roleLabel="Clinical staff">
      <div className="rounded-xl border border-brand-navy/10 bg-white p-6">
        <p className="text-sm text-brand-ink/80">
          Priority alerts, abnormal readings, and follow-up tasks will appear
          here in Sprint 2.
        </p>
      </div>
    </DashboardShell>
  );
}
