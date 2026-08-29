"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Care Team / Provider Workspace §5.7's "Action completed" step — the
 * explicit signal that the next_steps a doctor asked for actually happened,
 * separate from having asked for them. Only ever rendered for a document
 * whose acknowledgement_status is already 'action_required'; the RPC itself
 * (and, structurally, enforce_lab_result_document_update) refuse the call
 * from any other state, so this can't be reached out of order even by a
 * stale page.
 */
export function MarkActionCompletedButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const complete = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase.rpc("mark_result_document_action_completed", {
        p_document_id: documentId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={complete.isPending}
        onClick={() => complete.mutate()}
      >
        {complete.isPending ? "Saving…" : "Mark action completed"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
