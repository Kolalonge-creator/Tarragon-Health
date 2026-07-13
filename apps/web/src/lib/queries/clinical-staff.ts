import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ClinicalStaff = Tables<"clinical_staff">;

const ALL_STAFF_QUERY_KEY = ["clinical-staff", "all"];

async function getCallerOrganisationId(): Promise<string> {
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
  return profile.organisation_id;
}

/** Every clinical_staff record in the caller's org, any role/active state — admin management view. */
export function useAllClinicalStaff() {
  return useQuery({
    queryKey: ALL_STAFF_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff")
        .select("*")
        .order("role", { ascending: true })
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data as ClinicalStaff[];
    },
  });
}

/**
 * Adds a new clinical_staff record — starts inactive and unverified by
 * design (CLINICAL_TRUST_MODEL_SPEC.md §5: license verification, not
 * self-attestation). profilePhone is optional: links the record to an
 * existing login (needed for anyone who'll act in the system — sign
 * escalations, sign protocols); a Clinical Director can also exist as a
 * bio-only marketing record with no login.
 */
export function useCreateClinicalStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      role: ClinicalStaff["role"];
      fullName: string;
      credentialType?: string;
      credentialNumber?: string;
      specialty?: string;
      bio?: string;
      profilePhone?: string;
    }) => {
      const supabase = createClient();
      const organisationId = await getCallerOrganisationId();

      let profileId: string | null = null;
      if (input.profilePhone) {
        const { data: linkedProfile, error: profileError } = await supabase
          .from("profiles")
          .select("id")
          .eq("phone", input.profilePhone)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!linkedProfile) throw new Error("No account found with that phone number");
        profileId = linkedProfile.id;
      }

      const { error } = await supabase.from("clinical_staff").insert({
        organisation_id: organisationId,
        profile_id: profileId,
        role: input.role,
        full_name: input.fullName,
        credential_type: input.credentialType || null,
        credential_number: input.credentialNumber || null,
        specialty: input.specialty || null,
        bio: input.bio || null,
        active: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_STAFF_QUERY_KEY });
    },
  });
}

/**
 * Records license verification — sets license_verified_at + verified_by to
 * the admin performing the check, now. A DB constraint (not just this app
 * code) blocks verified_by from ever equaling the record's own profile_id,
 * so a clinician/doctor structurally cannot verify themselves.
 */
export function useVerifyClinicalStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (clinicalStaffId: string) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase
        .from("clinical_staff")
        .update({ license_verified_at: new Date().toISOString(), verified_by: user.id })
        .eq("id", clinicalStaffId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_STAFF_QUERY_KEY });
    },
  });
}

/**
 * Records indemnity/malpractice insurance details — required before a
 * Clinical Director or Escalation Doctor can be activated
 * (docs/CLINICAL_TRUST_MODEL_SPEC.md §5). A DB constraint
 * (clinical_staff_active_requires_indemnity), not just this app code, blocks
 * activation of those two roles without current, non-expired cover on file.
 */
export function useSetClinicalStaffIndemnity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clinicalStaffId,
      insurer,
      policyNumber,
      expiresAt,
    }: {
      clinicalStaffId: string;
      insurer: string;
      policyNumber: string;
      expiresAt: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinical_staff")
        .update({
          indemnity_insurer: insurer,
          indemnity_policy_number: policyNumber,
          indemnity_expires_at: new Date(expiresAt).toISOString(),
        })
        .eq("id", clinicalStaffId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_STAFF_QUERY_KEY });
    },
  });
}

/** Toggles active — the DB rejects activation of an unverified record (clinical_staff_active_requires_verification). */
export function useSetClinicalStaffActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clinicalStaffId, active }: { clinicalStaffId: string; active: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinical_staff")
        .update({ active })
        .eq("id", clinicalStaffId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_STAFF_QUERY_KEY });
    },
  });
}

export type ClinicalStaffIndemnityExemption = Tables<"clinical_staff_indemnity_exemptions">;

const INDEMNITY_EXEMPTIONS_QUERY_KEY = ["clinical-staff", "indemnity-exemptions"];

/**
 * Grants or revokes an individual indemnity exemption for one clinical_staff
 * record — the narrowest of the three exemption scopes (see
 * useAddIndemnityExemption for org-wide/role-wide). Revoking clears
 * indemnity_exempt_by too, since a false exemption shouldn't carry a stale
 * grantor. The DB rejects setting indemnity_exempt_by to the record's own
 * profile_id (clinical_staff_no_self_indemnity_exemption) — no one can
 * exempt themselves.
 */
export function useSetClinicalStaffIndemnityExempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clinicalStaffId, exempt }: { clinicalStaffId: string; exempt: boolean }) => {
      const supabase = createClient();
      if (!exempt) {
        const { error } = await supabase
          .from("clinical_staff")
          .update({ indemnity_exempt: false, indemnity_exempt_by: null })
          .eq("id", clinicalStaffId);
        if (error) throw error;
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase
        .from("clinical_staff")
        .update({ indemnity_exempt: true, indemnity_exempt_by: user.id })
        .eq("id", clinicalStaffId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_STAFF_QUERY_KEY });
    },
  });
}

/** The caller's org's current org-wide (role = null) and per-role indemnity exemptions. */
export function useOrgIndemnityExemptions() {
  return useQuery({
    queryKey: INDEMNITY_EXEMPTIONS_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff_indemnity_exemptions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ClinicalStaffIndemnityExemption[];
    },
  });
}

/**
 * Grants an org-wide (role omitted) or whole-role indemnity exemption —
 * covers every current and future Clinical Director/Escalation Doctor in
 * that scope, not just one named record (contrast
 * useSetClinicalStaffIndemnityExempt). RLS restricts inserts here to admins
 * only, since this waives a compliance gate at organisation/role scope
 * rather than for one named individual.
 */
export function useAddIndemnityExemption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      role,
      reason,
    }: {
      role: ClinicalStaff["role"] | null;
      reason?: string;
    }) => {
      const supabase = createClient();
      const organisationId = await getCallerOrganisationId();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase.from("clinical_staff_indemnity_exemptions").insert({
        organisation_id: organisationId,
        role,
        reason: reason || null,
        exempted_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INDEMNITY_EXEMPTIONS_QUERY_KEY });
    },
  });
}

/** Revokes an org-wide or per-role indemnity exemption. */
export function useRemoveIndemnityExemption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (exemptionId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinical_staff_indemnity_exemptions")
        .delete()
        .eq("id", exemptionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INDEMNITY_EXEMPTIONS_QUERY_KEY });
    },
  });
}

/** Active clinicians in the caller's org (RLS-scoped) — populates the care-team assignment select. */
export function useOrgClinicians() {
  return useQuery({
    queryKey: ["clinical-staff", "clinicians"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff")
        .select("*")
        .eq("role", "clinician")
        .eq("active", true)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data as ClinicalStaff[];
    },
  });
}

/**
 * Assigns (or reassigns) a patient's care team: the chosen clinician plus
 * whichever clinical_staff row is the org's active Clinical Director — the
 * caller never picks the director directly, since per
 * CLINICAL_TRUST_MODEL_SPEC.md §1 that's a single named role supervising
 * protocols org-wide, not a per-patient choice. One row per patient
 * (upsert on patient_id), assigned_at always reset to now().
 */
export function useAssignCareTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      clinicianProfileId,
    }: {
      patientId: string;
      organisationId: string;
      clinicianProfileId: string;
    }) => {
      const supabase = createClient();

      const { data: director } = await supabase
        .from("clinical_staff")
        .select("profile_id")
        .eq("organisation_id", organisationId)
        .eq("role", "clinical_director")
        .eq("active", true)
        .not("profile_id", "is", null)
        .maybeSingle();

      const { error } = await supabase.from("care_team_assignment").upsert(
        {
          organisation_id: organisationId,
          patient_id: patientId,
          clinician_id: clinicianProfileId,
          clinical_director_id: director?.profile_id ?? null,
          assigned_at: new Date().toISOString(),
        },
        { onConflict: "patient_id" }
      );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["care-team", variables.patientId] });
    },
  });
}
