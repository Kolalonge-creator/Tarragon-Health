"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { fetchLicenceVerifiedOn } from "@/lib/clinical/licence-verified";
import { LicenceVerifiedBadge } from "@/components/licence-verified-badge";

/** Client-side wrapper for components that already run in the browser (message thread, booking). One shared cache entry per id. */
export function LicenceVerifiedForClient({ id, className }: { id: string | null | undefined; className?: string }) {
  const { data } = useQuery({
    queryKey: ["licence-verified-on", id],
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => (id ? ((await fetchLicenceVerifiedOn(createClient(), [id])).get(id) ?? null) : null),
  });
  return <LicenceVerifiedBadge verifiedOn={data} className={className} />;
}
