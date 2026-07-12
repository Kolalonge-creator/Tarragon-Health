import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Json, Tables } from "@tarragon/shared";

export type ProtocolVersion = Tables<"protocol_versions"> & {
  approved_by_staff: { full_name: string; credential_type: string | null; credential_number: string | null } | null;
};

const QUERY_KEY = ["protocol-versions"];

async function getCallerOrgAndDirector(): Promise<{
  organisationId: string;
  directorStaffId: string;
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    throw new Error("This account has no organisation on file");
  }

  // Only the Clinical Director signs protocols (CLINICAL_TRUST_MODEL_SPEC.md
  // §1) — the caller's own clinical_staff record, not just any staff login,
  // must carry that role before a new version can be recorded.
  const { data: director } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("organisation_id", profile.organisation_id)
    .eq("profile_id", user.id)
    .eq("role", "clinical_director")
    .eq("active", true)
    .maybeSingle();
  if (!director) {
    throw new Error(
      "Only the org's active Clinical Director can sign a protocol version — add yourself to clinical_staff with that role first"
    );
  }

  return { organisationId: profile.organisation_id, directorStaffId: director.id };
}

/** Every signed protocol version in the caller's org, newest first. */
export function useProtocolVersions() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("protocol_versions")
        .select(
          "*, approved_by_staff:clinical_staff!protocol_versions_approved_by_fkey(full_name, credential_type, credential_number)"
        )
        .order("protocol_id", { ascending: true })
        .order("version_number", { ascending: false });
      if (error) throw error;
      return data as ProtocolVersion[];
    },
  });
}

/**
 * Signs a new protocol version. Append-only — there is no update/delete;
 * correcting a mistake means signing another version, per §5's
 * no-retroactive-attribution rule. version_number is the next integer for
 * this protocol_id in this org (select-then-insert, not a DB sequence —
 * fine at pilot write volume, and the unique constraint still catches a
 * concurrent-signing race).
 */
export function useCreateProtocolVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      protocolId,
      title,
      changeSummary,
      content,
    }: {
      protocolId: string;
      title: string;
      changeSummary: string;
      content: Json;
    }) => {
      const supabase = createClient();
      const { organisationId, directorStaffId } = await getCallerOrgAndDirector();

      const { data: latest } = await supabase
        .from("protocol_versions")
        .select("version_number")
        .eq("organisation_id", organisationId)
        .eq("protocol_id", protocolId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { error } = await supabase.from("protocol_versions").insert({
        organisation_id: organisationId,
        protocol_id: protocolId,
        version_number: (latest?.version_number ?? 0) + 1,
        title,
        change_summary: changeSummary,
        content,
        approved_by: directorStaffId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
