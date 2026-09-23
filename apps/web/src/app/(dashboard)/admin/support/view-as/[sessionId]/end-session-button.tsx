"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useEndSupportViewSession } from "@/lib/queries/support-view-as";

export function EndSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const endSession = useEndSupportViewSession();

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={endSession.isPending}
        onClick={() => {
          endSession.mutate(sessionId, { onSuccess: () => router.refresh() });
        }}
      >
        {endSession.isPending ? "Ending…" : "End session now"}
      </Button>
      {endSession.isError && (
        <p className="text-xs text-red-600">
          {endSession.error instanceof Error ? endSession.error.message : "Could not end this session. Try again."}
        </p>
      )}
    </div>
  );
}
