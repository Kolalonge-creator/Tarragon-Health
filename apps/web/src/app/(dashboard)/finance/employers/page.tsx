
import { EmployerRevenueWorkspace } from "../_components/revenue-workspaces";

export const metadata = { title: "Employer revenue" };

export default function FinanceEmployerRevenuePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">Employer revenue</h1>
        <p className="max-w-3xl text-charcoal-ink/60 dark:text-night-ink/60">What each employer has been invoiced, has paid and still owes for Membership seats.</p>
      </div>

      <EmployerRevenueWorkspace />

    </div>
  );
}
