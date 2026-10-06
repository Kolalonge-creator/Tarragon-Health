"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { PROTOCOL_DRAFT_QUEUE_MUTATION } from "@/lib/queries/protocol-drafts";

/**
 * Re-renders the surrounding server page whenever a protocol-draft mutation that
 * changes the hub's list succeeds (see PROTOCOL_DRAFT_QUEUE_MUTATION), and only
 * then: a refresh on any mutation would re-render the hub, and could reset a
 * half-filled sign form, because of something unrelated. The protocol draft manager signs through client-side mutations,
 * unlike the server-action managers beside it, so nothing tells the hub's
 * server-rendered list that a draft has just been promoted. Without this the
 * line would keep saying "waiting for your signature" after it was signed.
 */
export function RefreshOnMutationSuccess() {
  const queryClient = useQueryClient();
  const router = useRouter();
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.action.type === "success" &&
          event.mutation.options.mutationKey?.[0] === PROTOCOL_DRAFT_QUEUE_MUTATION
        ) {
          router.refresh();
        }
      }),
    [queryClient, router]
  );
  return null;
}
