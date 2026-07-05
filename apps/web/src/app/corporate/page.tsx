import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default function CorporateDashboardPage() {
  return (
    <DashboardShell title="Corporate wellness" roleLabel="Corporate admin">
      <div className="rounded-xl border border-brand-navy/10 bg-white p-6">
        <p className="text-sm text-brand-ink/80">
          Workforce screening compliance and health outcomes will appear here.
        </p>
      </div>
    </DashboardShell>
  );
}
