"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Re-renders the surrounding server page whenever a React Query mutation
 * succeeds. The protocol draft manager signs through client-side mutations,
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
        if (event.type === "updated" && event.action.type === "success") router.refresh();
      }),
    [queryClient, router]
  );
  return null;
}
