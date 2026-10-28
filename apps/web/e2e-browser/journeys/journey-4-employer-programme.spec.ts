import { expect, test } from "@playwright/test";
import { J4, startJourney } from "../../../../packages/shared/src/journeys/journeys";
import { newRunId } from "./harness/env";
import { finishJourney } from "./harness/report";
import { createUser, newOrganisation, signIn, type TestUser } from "./harness/sessions";
import { lit, sql, sqlRows, sqlValue } from "./harness/sql";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Journey 4 (spec D.7.3): an employer programme, as a PRIVACY PROPERTY test.
 *
 * A Lagos company enrols 300 staff with a cohort code. The company sees only aggregate participation and outcomes, never an
 * individual record, never reproductive or mental health data.
 *
 * What is real here:
 *  - the institution administrator, an admin, a clinician and a patient are REAL signed-in sessions (password, anon key). The
 *    access assertions are made through those sessions, never through the service role.
 *  - the 300 people join through the real `join_cohort` RPC (under a simulated authenticated session, for volume: signing 300
 *    real sessions in would only add minutes).
 * What is NOT possible, and is recorded rather than faked:
 *  - every person here is is_test (the founder's rule), and every aggregate in the platform excludes test accounts (INV-13). So
 *    no figure OVER the 300 can be produced from test data. The journey asserts that exclusion instead, and says so.
 */
const COHORT_SIZE = 300;
const SMALL_COHORT = 15;

const PATIENT_TABLES = [
  "vitals_readings",
  "symptoms",
  "medications",
  "lab_results",
  "triage_events",
  "clinical_tasks",
  "notifications",
  "menstrual_cycles",
  "menstrual_daily_logs",
  "reproductive_health_profiles",
  "patient_pregnancy",
  "contraception_plans",
  "mental_health_screens",
  "wellbeing_checkins",
  "care_circle_members",
  "profile_cohorts",
];

async function visibleRows(client: SupabaseClient, table: string, excludeId?: string): Promise<{ count: number | null; denied: boolean }> {
  let q = client.from(table).select("*", { count: "exact", head: true });
  if (excludeId && table === "profiles") q = q.neq("id", excludeId);
  const { count, error } = await q;
  if (error) {
    // A table the role has no grant on at all refuses the read. That is also "zero rows", and is reported as denied.
    return { count: 0, denied: true };
  }
  return { count, denied: false };
}

test.describe("Journey 4: an employer programme (privacy)", () => {
  test.setTimeout(900_000);

  test("institution view is aggregates only; staff data stays private", async ({}, testInfo) => {
    const run = startJourney(J4);
    const runId = newRunId();

    // ------------------------------------------------------------------ setup
    const tenant = newOrganisation(runId, "Journey 4 platform tenant");
    const employer = newOrganisation(runId, "Journey 4 Lagos employer", "corporate");
    const admin = await createUser(runId, "admin", { role: "admin", organisationId: tenant });
    const instAdmin = await createUser(runId, "employer-admin", { role: "corporate_admin", organisationId: employer });
    const clinician = await createUser(runId, "clinician", { role: "clinician", organisationId: tenant });
    sql(`
      insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
          license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
      values (${lit(tenant)}, ${lit(clinician.id)}, 'S85 untied clinician', 'MDCN', ${lit(`S85-j4-${clinician.id.slice(0, 8)}`)}, true, 'active', now(),
          ${lit(admin.id)}, 'senior_medical_officer'::public.doctor_tier, 'employed'::public.staff_employment_type, 2, true);
    `);
    // Two patients with real passwords (one is the "control" that proves rows exist and a patient can read their own).
    const realPatients: TestUser[] = [];
    for (let i = 0; i < 2; i++) realPatients.push(await createUser(runId, `staff-${i}`, { role: "patient", organisationId: tenant }));

    const adminClient = await signIn(admin);
    const cohortId: { big?: string; bigCode?: string; small?: string; smallCode?: string } = {};
    await run.step("institution-and-cohort-created", async () => {
      const mk = async (name: string, max: number) => {
        const r = await adminClient.rpc("admin_create_sponsor_cohort", {
          p_sponsor_org: employer,
          p_name: name,
          p_valid_from: new Date().toISOString().slice(0, 10),
          p_valid_to: new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10),
          p_max_uses: max,
        });
        expect(r.error, JSON.stringify(r.error)).toBeNull();
        return r.data as { id: string; code: string };
      };
      const big = await mk(`S85 staff ${runId}`, 1000);
      const small = await mk(`S85 pilot ${runId}`, 100);
      cohortId.big = big.id;
      cohortId.bigCode = big.code;
      cohortId.small = small.id;
      cohortId.smallCode = small.code;
      expect(big.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    });

    // ------------------------------------------------------------------ 300 people, joined by the cohort code
    await run.step("enrol-300-by-cohort-code", async () => {
      expect(cohortId.bigCode).toBeDefined();
      sql(`
        begin;
        create temp table s85_people(n int, id uuid);
        insert into s85_people select g, gen_random_uuid() from generate_series(1, ${COHORT_SIZE + SMALL_COHORT}) g;
        insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
          select id, 's85-j4-' || n || '-' || ${lit(runId)} || '@example.com', 'x', now(), '{}', '{}' from s85_people;
        insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test, language, receives_care)
          select id, ${lit(tenant)}, 'patient'::public.user_role, '[s85] Staff ' || n, (current_date - interval '40 years')::date, true, 'en', true from s85_people
          on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true;
        do $$
        declare r record; v_res jsonb; v_ok int := 0;
        begin
          for r in select * from s85_people order by n loop
            perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
            perform set_config('request.jwt.claim.role', 'authenticated', true);
            set local role authenticated;
            v_res := public.join_cohort(case when r.n <= ${COHORT_SIZE} then ${lit(cohortId.bigCode!)} else ${lit(cohortId.smallCode!)} end);
            reset role;
            if (v_res ->> 'ok') = 'true' then v_ok := v_ok + 1; end if;
          end loop;
          if v_ok <> ${COHORT_SIZE + SMALL_COHORT} then raise exception 'only % of % joined', v_ok, ${COHORT_SIZE + SMALL_COHORT}; end if;
        end $$;
        commit;
      `);
      const joined = Number(sqlValue<string>(`select count(*)::text from public.profile_cohorts where cohort_id = ${lit(cohortId.big!)} and left_at is null`));
      expect(joined).toBe(COHORT_SIZE);
      const small = Number(sqlValue<string>(`select count(*)::text from public.profile_cohorts where cohort_id = ${lit(cohortId.small!)} and left_at is null`));
      expect(small).toBe(SMALL_COHORT);
    });

    // Rows that must never reach the employer: blood pressure for everyone, reproductive and mental health rows for many.
    sql(`
      insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
        select ${lit(tenant)}, patient_id, 'blood_pressure', 150, 95, now() - interval '3 days', 'manual'
          from public.profile_cohorts where cohort_id in (${lit(cohortId.big ?? "")}, ${lit(cohortId.small ?? "")});
    `);
    sql(`
      insert into public.menstrual_cycles (organisation_id, patient_id, period_start_date)
        select ${lit(tenant)}, patient_id, current_date - 20 from public.profile_cohorts where cohort_id = ${lit(cohortId.big ?? "")};
      insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band)
        select ${lit(tenant)}, patient_id, 'phq9', 12, 'moderate' from public.profile_cohorts where cohort_id = ${lit(cohortId.big ?? "")};
      insert into public.wellbeing_checkins (organisation_id, patient_id, mood_score, stress_score, sleep_quality, activity_level)
        select ${lit(tenant)}, patient_id, 2, 4, 2, 2 from public.profile_cohorts where cohort_id = ${lit(cohortId.big ?? "")};
    `);
    const seeded = {
      vitals: Number(sqlValue<string>(`select count(*)::text from public.vitals_readings where patient_id in (select patient_id from public.profile_cohorts where cohort_id = ${lit(cohortId.big ?? "")})`)),
    };
    expect(seeded.vitals, "the fixture must contain rows, or every later 'zero rows' check is vacuous").toBeGreaterThan(0);

    // S88: the nine pregnancy and maternal tables must hold rows for the two real patients, or the untied-clinician step below reads zero rows from EMPTY
    // tables and proves nothing. The owner connection (psql) inserts them; the lifecycle rows are written directly because the hook would otherwise decide
    // by stage whether to record anything. These are is_test fixture rows on is_test accounts, never anyone's real record.
    const maternalTables = [
      "pregnancies", "kick_counts", "contractions", "birth_plans", "postnatal_baby_checks", "breastfeeding_feed_log",
      "lifecycle_states", "lifecycle_events", "pregnancy_loss_records",
    ] as const;
    {
      const ids = realPatients.map((p) => lit(p.id)).join(", ");
      sql(`
        begin;
        insert into public.pregnancies (organisation_id, patient_id, pregnancy_number, lmp, edd, source, is_test)
          select ${lit(tenant)}, p, 0, current_date - 140, current_date + 140, 'system', true from unnest(array[${ids}]::uuid[]) p;
        insert into public.kick_counts (organisation_id, patient_id, pregnancy_id, client_id, started_at, result, config_version, source, is_test)
          select ${lit(tenant)}, g.patient_id, g.id, gen_random_uuid(), now(), 'target_reached', 1, 'patient', true from public.pregnancies g where g.patient_id in (${ids});
        insert into public.contractions (organisation_id, patient_id, pregnancy_id, client_id, started_at, pattern, result, config_version, source, is_test)
          select ${lit(tenant)}, g.patient_id, g.id, gen_random_uuid(), now(), 'standard', 'keep_timing', 1, 'patient', true from public.pregnancies g where g.patient_id in (${ids});
        insert into public.birth_plans (organisation_id, patient_id, pregnancy_id, place_of_birth, source, is_test)
          select ${lit(tenant)}, g.patient_id, g.id, 'S88 journey hospital', 'patient', true from public.pregnancies g where g.patient_id in (${ids});
        insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type)
          select ${lit(tenant)}, p, 'formula' from unnest(array[${ids}]::uuid[]) p;
        insert into public.lifecycle_states (patient_id, organisation_id, stage) select p, ${lit(tenant)}, 'pregnant' from unnest(array[${ids}]::uuid[]) p
          on conflict (patient_id) do update set stage = 'pregnant';
        insert into public.lifecycle_events (organisation_id, patient_id, kind, from_stage, to_stage, occurred_on, cause, config_version)
          select ${lit(tenant)}, p, 'pregnancy_confirmed', 'tracking', 'pregnant', current_date - 30, 'self_confirmed', 1 from unnest(array[${ids}]::uuid[]) p;
        insert into public.pregnancy_loss_records (organisation_id, patient_id, occurred_on, gestation_weeks, note, source)
          select ${lit(tenant)}, p, current_date - 60, 8, 'S88 journey fixture note', 'patient_entered' from unnest(array[${ids}]::uuid[]) p;
        insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date, delivery_mode)
          select ${lit(tenant)}, p, current_date - 3, 'vaginal' from unnest(array[${ids}]::uuid[]) p;
        insert into public.postnatal_baby_checks (organisation_id, patient_id, postnatal_profile_id, check_window, scheduled_date)
          select ${lit(tenant)}, pp.patient_id, pp.id, 'week_1', current_date + 4 from public.postnatal_profiles pp where pp.patient_id in (${ids})
          on conflict (postnatal_profile_id, check_window) do nothing;
        commit;
      `);
      for (const t of maternalTables) {
        const n = Number(sqlValue<string>(`select count(*)::text from public.${t} where patient_id in (${ids})`));
        expect(n, `the fixture must hold rows in ${t}, or the untied-clinician zero read below is vacuous`).toBeGreaterThan(0);
      }
    }

    // ------------------------------------------------------------------ the institution session
    const inst = await signIn(instAdmin);

    // S79 (#1341): a staff member redeems a code with the console's one entry point. The module ships OFF, so the step switches it on in this throwaway
    // database only and restores it, with a control that the call is refused while it is off.
    await run.step("institution-console-redemption", async () => {
      const wasOn = sqlValue<string>(`select is_enabled::text from public.platform_modules where key = 'institution_console'`) === "true";
      const redeemer = await createUser(runId, "console-redeemer", { role: "patient", organisationId: tenant });
      sql(`update public.profiles set is_test = true, receives_care = true, date_of_birth = (current_date - interval '40 years')::date where id = ${lit(redeemer.id)};`);
      const consoleCohort = await adminClient.rpc("admin_create_sponsor_cohort", {
        p_sponsor_org: employer,
        p_name: `S85 console ${runId}`,
        p_valid_from: new Date().toISOString().slice(0, 10),
        p_valid_to: new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10),
        p_max_uses: 10,
      });
      expect(consoleCohort.error, JSON.stringify(consoleCohort.error)).toBeNull();
      const code = (consoleCohort.data as { code: string }).code;
      const client = await signIn(redeemer);
      try {
        sql(`update public.platform_modules set is_enabled = false where key = 'institution_console';`);
        const off = await client.rpc("enter_enrolment_code", { p_code: code });
        expect(off.error, "the console accepted a code while the module was off").not.toBeNull();
        sql(`update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = ${lit(admin.id)}, activation_note = 'S85 journey 4 local fixture' where key = 'institution_console';`);
        const wrong = await client.rpc("enter_enrolment_code", { p_code: "ZZZZZZZZ" });
        expect(wrong.error, JSON.stringify(wrong.error)).toBeNull();
        expect(wrong.data).toMatchObject({ ok: false });
        const ok = await client.rpc("enter_enrolment_code", { p_code: code });
        expect(ok.error, JSON.stringify(ok.error)).toBeNull();
        expect(ok.data).toMatchObject({ ok: true, kind: "programme" });
        expect(Number(sqlValue<string>(`select count(*)::text from public.profile_cohorts where patient_id = ${lit(redeemer.id)} and left_at is null`))).toBe(1);
      } finally {
        sql(`update public.platform_modules set is_enabled = ${wasOn ? "true" : "false"} where key = 'institution_console';`);
      }
    });

    await run.step("institution-reads-no-patient-rows", async () => {
      const found: string[] = [];
      for (const t of PATIENT_TABLES) {
        const r = await visibleRows(inst, t);
        if ((r.count ?? 0) > 0) found.push(`${t}: ${r.count}`);
      }
      const others = await visibleRows(inst, "profiles", instAdmin.id);
      if ((others.count ?? 0) > 0) found.push(`profiles (not their own): ${others.count}`);
      expect(found, "the institution session read patient rows").toEqual([]);
      // control: the rows exist (owner view) and a real patient session reads their own
      expect(seeded.vitals).toBeGreaterThan(0);
    });

    // An untied clinician (same organisation, no task, lead assignment or page) must read none of these tables for any patient. History: S56 closed
    // mental_health_screens and wellbeing_checkins; S39b (tied staff reads, merged) tied most cycle, reproductive and pregnancy summary tables; S88 tied the
    // nine pregnancy and maternal tables (pregnancies, kick_counts, contractions, birth_plans, postnatal_baby_checks, breastfeeding_feed_log,
    // lifecycle_states, lifecycle_events, pregnancy_loss_records).
    // KNOWN GAP (shrink only, founder-approved 2026-10-28): `menstrual_cycles` is still readable by an untied clinician in the CI replay (the same
    // pending state main-dev has had since S85). It is NOT an S88 table and is tracked separately under OQ-549; its select policy has an S39b
    // `staff_may_read` arm plus emergency and `can_read_clinical` arms and which arm admits the clinician is not yet traced. The step is pending(S39b)
    // exactly while the leak equals this list. ANY other leaked table, and in particular any of the nine S88 tables, fails the journey naming the
    // table; a table that stops leaking also fails it until it is removed from this list (the list only shrinks).
    const KNOWN_UNTIED_CLINICIAN_READS = ["menstrual_cycles"];
    const S88_TIED_TABLES = [
      "pregnancies", "kick_counts", "contractions", "birth_plans", "postnatal_baby_checks", "breastfeeding_feed_log", "lifecycle_states", "lifecycle_events",
      "pregnancy_loss_records",
    ];
    const untiedTables = [
      "vitals_readings", "symptoms", "lab_results", "menstrual_cycles", "menstrual_daily_logs", "mental_health_screens", "wellbeing_checkins",
      "reproductive_health_profiles", "patient_pregnancy", "contraception_plans",
      ...S88_TIED_TABLES,
    ];
    const untied: string[] = [];
    {
      const doc = await signIn(clinician);
      for (const t of untiedTables) {
        const r = await visibleRows(doc, t);
        if ((r.count ?? 0) > 0) untied.push(t);
      }
    }
    // The nine S88 tables never get a pending pass: they fail on any leak, whatever the known list says.
    await run.step("s88-tables-untied-clinician-reads-nothing", async () => {
      expect(untied.filter((t) => S88_TIED_TABLES.includes(t)), "an untied clinician read an S88-tied pregnancy or maternal table").toEqual([]);
    });
    if (untied.length === 0) {
      await run.step("clinician-without-tie-reads-nothing", async () => {});
    } else if (JSON.stringify([...untied].sort()) === JSON.stringify([...KNOWN_UNTIED_CLINICIAN_READS].sort())) {
      run.pending(
        "clinician-without-tie-reads-nothing",
        "S39b",
        `an untied clinician still reads ${untied.join(", ")} for the whole organisation (known gap, OQ-549, not an S88 table). The nine S88 tables and the other ${untiedTables.length - untied.length} listed tables are correctly empty.`,
      );
    } else {
      await run.step("clinician-without-tie-reads-nothing", async () => {
        expect(untied, `the untied-clinician leak changed (known: ${KNOWN_UNTIED_CLINICIAN_READS.join(", ")})`).toEqual(KNOWN_UNTIED_CLINICIAN_READS);
      });
    }

    await run.step("patient-reads-own-control", async () => {
      const p = await signIn(realPatients[0]!);
      sql(`insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
             values (${lit(tenant)}, ${lit(realPatients[0]!.id)}, 'blood_pressure', 132, 84, now() - interval '1 day', 'manual');`);
      const mine = await visibleRows(p, "vitals_readings");
      expect(mine.count, "a real patient session could not read their own reading, so the empty results above prove nothing").toBe(1);
    });

    // The institution's own view: the aggregate surfaces an employer administrator can call.
    const surfaces: Array<{ name: string; payload: unknown }> = [];
    await run.step("institution-view-aggregates-only", async () => {
      const counts = await inst.rpc("employer_roster_counts", { p_organisation_id: employer });
      surfaces.push({ name: "employer_roster_counts", payload: counts.data ?? counts.error });
      const subsidy = await inst.rpc("institution_subsidy_summary", { p_organisation_id: employer });
      surfaces.push({ name: "institution_subsidy_summary", payload: subsidy.data ?? subsidy.error });
      const programmes = await inst.rpc("sponsor_staff_programmes");
      surfaces.push({ name: "sponsor_staff_programmes", payload: programmes.data ?? programmes.error });
      const text = JSON.stringify(surfaces);
      console.log(`[J4] institution surfaces: ${text.slice(0, 600)}`);
      // not vacuous: at least one aggregate surface must have actually answered (an error everywhere would also "leak nothing")
      expect(
        [counts, subsidy, programmes].filter((r) => r.error === null).length,
        "every institution surface refused; the aggregate view was never exercised",
      ).toBeGreaterThan(0);
      const people = sqlRows<{ id: string; email: string | null; full_name: string }>(
        `select p.id, u.email, p.full_name from public.profiles p join auth.users u on u.id = p.id where p.id in (select patient_id from public.profile_cohorts where cohort_id in (${lit(cohortId.big!)}, ${lit(cohortId.small!)}))`,
      );
      expect(people.length).toBe(COHORT_SIZE + SMALL_COHORT);
      const leaked = people.filter(
        (p) => text.includes(p.id) || (p.email && text.includes(p.email)) || (p.full_name && p.full_name.length > 3 && text.includes(p.full_name)),
      );
      expect(leaked.map((p) => p.id), "an institution surface returned an individual").toEqual([]);
      expect(text).not.toMatch(/systolic|diastolic|menstrual|pregnan|contracepti|phq|mood|mental/i);
    });

    await run.step("small-cells-suppressed", async () => {
      const bigReport = await adminClient.rpc("sponsor_outcome_report", { p_cohort: cohortId.big! });
      const smallReport = await adminClient.rpc("sponsor_outcome_report", { p_cohort: cohortId.small! });
      expect(bigReport.error, JSON.stringify(bigReport.error)).toBeNull();
      expect(smallReport.error, JSON.stringify(smallReport.error)).toBeNull();
      const small = smallReport.data as { members: { suppressed: boolean }; minimum_cell: number };
      expect(small.members.suppressed, "a cohort of 15 must be withheld whole").toBe(true);
      expect(small.minimum_cell).toBeGreaterThanOrEqual(20);
      // INV-13: test accounts are excluded from every aggregate, so even the 300 are counted as nobody. The report must say
      // 'withheld', never show a number, for a population it cannot count.
      const big = bigReport.data as { members: { suppressed: boolean; joined?: number } };
      expect(big.members.suppressed).toBe(true);
      expect(big.members.joined).toBeUndefined();
    });

    run.skipped(
      "aggregate-figures-over-300-people",
      "every aggregate excludes is_test accounts (INV-13) and the rule here is that test data is always is_test, so a real figure over 300 people cannot be produced from test data; the exclusion itself is asserted in small-cells-suppressed (see OQ-340)",
    );

    await run.step("no-reproductive-or-mental-health", async () => {
      // the rows exist (owner view) ...
      const exist = sqlRows<{ tbl: string; cnt: string }>(
        `select 'menstrual_cycles' as tbl, count(*)::text as cnt from public.menstrual_cycles where patient_id in (select patient_id from public.profile_cohorts where cohort_id = ${lit(cohortId.big!)})
         union all select 'mental_health_screens', count(*)::text from public.mental_health_screens where patient_id in (select patient_id from public.profile_cohorts where cohort_id = ${lit(cohortId.big!)})
         union all select 'wellbeing_checkins', count(*)::text from public.wellbeing_checkins where patient_id in (select patient_id from public.profile_cohorts where cohort_id = ${lit(cohortId.big!)})`,
      );
      for (const r of exist) expect(Number(r.cnt), `fixture has no ${r.tbl} rows, so the check below would be vacuous`).toBeGreaterThan(0);
      // ... the institution session cannot read them, and nothing the institution can call mentions them
      for (const t of ["menstrual_cycles", "menstrual_daily_logs", "reproductive_health_profiles", "patient_pregnancy", "contraception_plans", "mental_health_screens", "wellbeing_checkins"]) {
        const r = await visibleRows(inst, t);
        expect(r.count ?? 0, `${t} is visible to the institution`).toBe(0);
      }
      expect(JSON.stringify(surfaces)).not.toMatch(/menstrual|pregnan|contracepti|phq|mood|mental|wellbeing|reproductive/i);
    });

    await finishJourney(run, testInfo);
  });
});
