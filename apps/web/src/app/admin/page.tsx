import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default function AdminDashboardPage() {
  return (
    <DashboardShell title="Platform admin" roleLabel="Admin">
      <div className="rounded-xl border border-brand-navy/10 bg-white p-6">
        <p className="text-sm text-brand-ink/80">
          User management, org settings, and system health will live here.
        </p>
      </div>
    </DashboardShell>
  );
}
