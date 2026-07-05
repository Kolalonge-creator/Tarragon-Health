import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default function HmoDashboardPage() {
  return (
    <DashboardShell title="HMO overview" roleLabel="HMO admin">
      <div className="rounded-xl border border-brand-navy/10 bg-white p-6">
        <p className="text-sm text-brand-ink/80">
          Member population risk and care-gap tracking will appear here.
        </p>
      </div>
    </DashboardShell>
  );
}
