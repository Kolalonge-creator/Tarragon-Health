import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ClinicalStaff = Tables<"clinical_staff">;

const ALL_STAFF_QUERY_KEY = ["clinical-staff", "all"];
const CLINICAL_STAFF_PHOTO_BUCKET = "clinical-staff-photos";

/** Uploads to the public clinical-staff-photos bucket and returns the resulting public URL for clinical_staff.photo_url. */
async function uploadClinicalStaffPhoto(
  supabase: ReturnType<typeof createClient>,
  organisationId: string,
  file: File
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${organisationId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(CLINICAL_STAFF_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return supabase.storage.from(CLINICAL_STAFF_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

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

/** Every clinical_staff record in the caller's org, any tier/active state — admin management view. */
export function useAllClinicalStaff() {
  return useQuery({
    queryKey: ALL_STAFF_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff")
        .select("*")
        .order("doctor_tier", { ascending: false })
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data as ClinicalStaff[];
    },
  });
}

/**
 * Latest attestation expiry per clinical_staff_id in the caller's org (AHC
 * pathway §26). Returns a map so the admin manager can badge each doctor's
 * red-flag attestation status. Reads the append-only history and keeps the
 * newest expiry per staff member.
 */
export function useOrgAttestationStatuses() {
  return useQuery({
    queryKey: ["clinical-staff", "attestations"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff_attestations")
        .select("clinical_staff_id, expires_at")
        .order("expires_at", { ascending: false });
      if (error) throw error;
      const latest: Record<string, string> = {};
      for (const row of data ?? []) {
        if (!(row.clinical_staff_id in latest)) latest[row.clinical_staff_id] = row.expires_at;
      }
      return latest;
    },
  });
}

/**
 * Adds a new clinical_staff record — starts inactive and unverified by
 * design (CLINICAL_TRUST_MODEL_SPEC.md §5: license verification, not
 * self-attestation). profilePhone is optional: links the record to an
 * existing login (needed for anyone who'll act in the system — sign
 * escalations, sign protocols); the Chief Medical Officer can also exist as
 * a bio-only marketing record with no login. doctorTier is never
 * inferred/defaulted, per the "never infer a doctor_tier in code" rule — an
 * admin picks it explicitly. employmentType decides, alongside tier,
 * whether individual indemnity tracking is required (see
 * useSetClinicalStaffEmploymentType).
 */
export function useCreateClinicalStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      doctorTier: ClinicalStaff["doctor_tier"];
      employmentType: ClinicalStaff["employment_type"];
      fullName: string;
      credentialType?: string;
      credentialNumber?: string;
      specialty?: string;
      bio?: string;
      profilePhone?: string;
      photoFile?: File;
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

      const photoUrl = input.photoFile
        ? await uploadClinicalStaffPhoto(supabase, organisationId, input.photoFile)
        : null;

      const { error } = await supabase.from("clinical_staff").insert({
        organisation_id: organisationId,
        profile_id: profileId,
        doctor_tier: input.doctorTier,
        employment_type: input.employmentType,
        full_name: input.fullName,
        credential_type: input.credentialType || null,
        credential_number: input.credentialNumber || null,
        specialty: input.specialty || null,
        bio: input.bio || null,
        photo_url: photoUrl,
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
 * Clinical Director or Tier 4/5 clinician can be activated
 * (docs/CLINICAL_TRUST_MODEL_SPEC.md §5,
 * docs/Tarragon_Health_Master_Operating_Plan_v4.md §4). A DB trigger
 * (private.enforce_clinical_staff_indemnity), not just this app code,
 * blocks activation of those without current, non-expired cover on file.
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

/**
 * Records the real expiry date on the clinician's MDCN/NMCN Annual
 * Practicing License, read off the physical/PDF licence document — distinct
 * from license_verified_at (when Tarragon last checked the record). Optional;
 * private.notify_clinical_staff_license_lapses() only warns once this is set.
 */
export function useSetClinicalStaffLicenseExpiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clinicalStaffId,
      expiresAt,
    }: {
      clinicalStaffId: string;
      expiresAt: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinical_staff")
        .update({ license_expires_at: new Date(expiresAt).toISOString() })
        .eq("id", clinicalStaffId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_STAFF_QUERY_KEY });
    },
  });
}

/**
 * Toggles employed/contracted — this is what decides, alongside tier,
 * whether individual indemnity tracking is required
 * (private.enforce_clinical_staff_indemnity): chief_medical_officer always
 * needs it, senior_medical_officer only when contracted, medical_officer
 * never does (employed staff stay under Tarragon's institutional policy).
 * Editable post-creation since a Senior Medical Officer's employment
 * relationship can change over time, unlike tier/name/credential.
 */
export function useSetClinicalStaffEmploymentType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clinicalStaffId,
      employmentType,
    }: {
      clinicalStaffId: string;
      employmentType: ClinicalStaff["employment_type"];
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinical_staff")
        .update({ employment_type: employmentType })
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

/**
 * Edits specialty/bio/photo on an existing clinical_staff record — the
 * fields the admin manager had no way to change after creation (only
 * verify/activate existed). Name/credential/tier stay create-time-only:
 * changing those carries more weight (re-verification, tier authority) and
 * isn't part of this action. photoFile uploads and replaces the photo;
 * removePhoto clears it; passing neither leaves the existing photo alone.
 */
export function useUpdateClinicalStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clinicalStaffId,
      organisationId,
      specialty,
      bio,
      photoFile,
      removePhoto,
    }: {
      clinicalStaffId: string;
      organisationId: string;
      specialty: string;
      bio: string;
      photoFile?: File;
      removePhoto?: boolean;
    }) => {
      const supabase = createClient();

      let photoUrl: string | null | undefined;
      if (photoFile) {
        photoUrl = await uploadClinicalStaffPhoto(supabase, organisationId, photoFile);
      } else if (removePhoto) {
        photoUrl = null;
      }

      const { error } = await supabase
        .from("clinical_staff")
        .update({
          specialty: specialty.trim() || null,
          bio: bio.trim() || null,
          ...(photoUrl !== undefined ? { photo_url: photoUrl } : {}),
        })
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

/** The caller's org's current org-wide, per-tier and director-wide indemnity exemptions. */
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
 * Grants an org-wide or whole-tier indemnity exemption — covers every
 * current and future clinical_staff record in that scope, not just one named
 * record (contrast useSetClinicalStaffIndemnityExempt). doctorTier null
 * means org-wide. Director-wide exemption no longer exists as a separate
 * scope: Clinical Director authority is intrinsic to doctor_tier =
 * 'chief_medical_officer', so a tier-wide exemption on that value covers it.
 * RLS restricts inserts here to admins only, since this waives a compliance
 * gate at organisation/tier scope rather than for one named individual.
 */
export function useAddIndemnityExemption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      doctorTier,
      reason,
    }: {
      doctorTier: ClinicalStaff["doctor_tier"] | null;
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
        doctor_tier: doctorTier,
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

/** Revokes an org-wide, per-tier, or director-wide indemnity exemption. */
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

/**
 * Active Medical Officer / Senior Medical Officer clinicians in the caller's
 * org (RLS-scoped) — populates the care-team assignment select. That band is
 * the day-to-day care-team per docs/Tarragon_Health_Master_Operating_Plan_v4.md
 * §4 (Chief Medical Officer is escalation/governance, not a per-patient
 * assignment — same as old Tier 4/5).
 */
export function useOrgClinicians() {
  return useQuery({
    queryKey: ["clinical-staff", "clinicians"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff")
        .select("*")
        .in("doctor_tier", ["medical_officer", "senior_medical_officer"])
        .eq("active", true)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data as ClinicalStaff[];
    },
  });
}

/**
 * Every active clinical-tier doctor in the caller's org (Medical Officer
 * through Chief Medical Officer, `care_coordinator` excluded by name) —
 * populates the Chief Medical Officer's "Assign to…" case-reassignment
 * picker (see useAssignEscalation in lib/queries/escalations.ts,
 * canAssignCases in lib/clinical/doctor-tier.ts). Deliberately broader than
 * useOrgClinicians, which excludes Chief Medical Officer since that hook
 * feeds the per-patient care-team assignment select, not case reassignment —
 * a Chief Medical Officer can validly assign an escalation to another Chief
 * Medical Officer covering a shift.
 */
export function useAssignableDoctors(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["clinical-staff", "assignable-doctors"],
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff")
        .select("profile_id, full_name, doctor_tier")
        .neq("doctor_tier", "care_coordinator")
        .eq("active", true)
        .not("profile_id", "is", null)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Care Coordinator accounts in the caller's org — populates the optional
 * coordinator select on the care-team form. Coordinators are profiles
 * (role = care_coordinator), not clinical_staff: they're employed non-clinical
 * staff, so they carry no tier/credential record. Staff can read these rows
 * via profiles' is_org_staff SELECT arm.
 */
export function useOrgCareCoordinators() {
  return useQuery({
    queryKey: ["clinical-staff", "care-coordinators"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("role", "care_coordinator")
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Assigns (or reassigns) a patient's care team: the chosen clinician plus
 * whichever clinical_staff row is the org's active Clinical Director — the
 * caller never picks the director directly, since per
 * CLINICAL_TRUST_MODEL_SPEC.md §1 that's a single named role supervising
 * protocols org-wide, not a per-patient choice. The Care Coordinator is an
 * optional third member (logistics-only, Maven "Care Advocate" surface). One
 * row per patient (upsert on patient_id), assigned_at always reset to now().
 */
export function useAssignCareTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      clinicianProfileId,
      careCoordinatorId,
    }: {
      patientId: string;
      organisationId: string;
      clinicianProfileId: string;
      careCoordinatorId?: string | null;
    }) => {
      const supabase = createClient();

      const { data: director } = await supabase
        .from("clinical_staff")
        .select("profile_id")
        .eq("organisation_id", organisationId)
        .eq("doctor_tier", "chief_medical_officer")
        .eq("active", true)
        .not("profile_id", "is", null)
        .maybeSingle();

      const { error } = await supabase.from("care_team_assignment").upsert(
        {
          organisation_id: organisationId,
          patient_id: patientId,
          clinician_id: clinicianProfileId,
          clinical_director_id: director?.profile_id ?? null,
          care_coordinator_id: careCoordinatorId ?? null,
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
