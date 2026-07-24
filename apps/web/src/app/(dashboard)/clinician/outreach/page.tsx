import Link from "next/link";
import { OutreachWorklist } from "@/components/clinical/outreach-worklist";

export default function ClinicianOutreachPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <Link href="/clinician" className="text-sm text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <OutreachWorklist />
    </div>
  );
}
