import Link from "next/link";
import { ClinicianMessagesWorklist } from "./worklist";

export default function ClinicianMessagesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <Link href="/clinician" className="text-sm text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <ClinicianMessagesWorklist />
    </div>
  );
}
