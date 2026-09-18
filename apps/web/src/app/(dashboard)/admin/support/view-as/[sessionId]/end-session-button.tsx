"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useEndSupportViewSession } from "@/lib/queries/support-view-as";

export function EndSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const endSession = useEndSupportViewSession();

  return (
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
  );
}
