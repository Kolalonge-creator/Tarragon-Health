import { ClinicianMessagesWorklist } from "./worklist";
import { NoteRequestsPanel } from "./note-requests-panel";
import { parseInboxView } from "@/lib/worklist/care-thread-queue";

export default async function ClinicianMessagesPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const { view } = await searchParams;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Patient messages</h1>
        <p className="text-sm text-charcoal-ink/60">
          In-app care messaging threads with your patients.
        </p>
      </div>
      <ClinicianMessagesWorklist initialView={parseInboxView(view)} />
      <NoteRequestsPanel />
    </div>
  );
}
