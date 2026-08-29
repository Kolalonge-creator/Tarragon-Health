"use client";

import { useState } from "react";
import { useAdvanceAppointmentStatus } from "@/lib/queries/appointments";
import { Button } from "@/components/ui/button";

export function CheckInNowButton({ appointmentId, status }: { appointmentId: string; status: string }) {
  const advance = useAdvanceAppointmentStatus();
  const [done, setDone] = useState(status !== "booked" && status !== "confirmed");
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return <p className="text-center text-sm font-medium text-brand-green">You&apos;re checked in — take a seat.</p>;
  }

  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        disabled={advance.isPending}
        onClick={async () => {
          setError(null);
          try {
            await advance.mutateAsync({ appointmentId, to: "checked_in" });
            setDone(true);
          } catch (e) {
            setError((e as Error).message || "Could not check in — ask reception for help.");
          }
        }}
      >
        {advance.isPending ? "Checking in…" : "Check in now"}
      </Button>
      {error && <p className="text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}
