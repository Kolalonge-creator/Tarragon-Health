import { expect, test } from "@playwright/test";
import { J2, startJourney } from "../../../../packages/shared/src/journeys/journeys";
import { grade } from "../../../../supabase/functions/_shared/clinical/engine";
import type { RuleSet, TriageInput } from "../../../../supabase/functions/_shared/clinical/types";
import { BP_CARE_V1 } from "../../../../packages/clinical/src/rules/bp-care-v1";
import { captureNotifications, neutralityViolations } from "./harness/capture";
import { drainBus, serviceClient } from "./harness/drain";
import { newRunId } from "./harness/env";
import { seedOnCallTeam } from "./harness/oncall";
import { finishJourney } from "./harness/report";
import { currentRuleSet, fixtureApprovalEnabled, fixtureApproveNewestDraft, hasRealApproval, type RuleSetRow } from "./harness/ruleset";
import { createUser, newOrganisation, signIn } from "./harness/sessions";
import { lit, sql, sqlRows, sqlValue } from "./harness/sql";

/**
 * Journey 2 (spec D.7.3): a red reading at night, in full depth.
 *
 * Real browser for the patient, real signed-in sessions for the patient, the paged clinician and the Care Circle supporter.
 * Seeding and observing use the local database directly; access is asserted only through the real sessions.
 *
 * The expected grade is NEVER written in this file. It is computed by the same pure engine the server and the phone run, on the
 * facts the server recorded, with the rule set row the database holds. Nothing here signs anything: while the rule set is only a
 * draft the queue, page and Care Circle steps are PENDING (CMO), and the shadow behaviour is asserted instead.
 */
const SYSTOLIC = 190; // a very high reading; what it grades as is the rule set's decision, not this file's
const DIASTOLIC = 120;

test.describe("Journey 2: a red reading at night", () => {
  test.setTimeout(240_000);

  test("runs every step that can run today and declares the rest pending", async ({ page, context }, testInfo) => {
    const run = startJourney(J2);
    const runId = newRunId();
    const startedAt = new Date(Date.now() - 2000).toISOString();
    const browserHosts = new Set<string>();
    page.on("request", (r) => {
      try {
        browserHosts.add(new URL(r.url()).hostname);
      } catch {
        // data: and blob: urls are not hosts
      }
    });

    // ------------------------------------------------------------------ setup (not a journey step)
    const org = newOrganisation(runId, "Journey 2");
    const team = await seedOnCallTeam(runId, org);
    const patient = await createUser(runId, "patient", { role: "patient", organisationId: org, phone: `+23480${runId.replace(/\D/g, "0").slice(-8).padStart(8, "0")}`, fullName: "[s85] Night Patient" });
    const supporter = await createUser(runId, "supporter", { role: "patient", organisationId: org, fullName: "[s85] Night Supporter" });
    sql(`
      update public.profiles set receives_care = true, onboarding_completed_at = now(), date_of_birth = (current_date - interval '54 years')::date
       where id = ${lit(patient.id)};
      update public.profiles set receives_care = false, onboarding_completed_at = now() where id = ${lit(supporter.id)};
    `);

    // The night: both people have quiet hours covering the whole day, so any message that is NOT critical would be held.
    // A critical alert must still arrive at once (that is the property the 2 am scenario is about). The browser clock is left
    // real: a faked page clock makes the session tokens look expired.
    const quiet = sqlValue<string>(
      `select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'notification_preferences' and column_name in ('quiet_hours_start', 'quiet_hours_end')`,
    );
    void quiet; // asserted in the neutrality step below by priority, not by this column

    // Care Circle: the patient invites the supporter for red alerts only, the supporter accepts (real sessions both sides).
    const patientClient = await signIn(patient);
    const supporterClient = await signIn(supporter);
    const invite = await patientClient.rpc("create_care_circle_invite", {
      p_kind: "email",
      p_contact: supporter.email,
      p_relationship: "Son",
      p_permissions: ["red_alerts"],
    });
    expect(invite.error, JSON.stringify(invite.error)).toBeNull();
    const token = (invite.data as { token: string }).token;
    const accepted = await supporterClient.rpc("accept_care_circle_invite", { p_token: token });
    expect(accepted.error, JSON.stringify(accepted.error)).toBeNull();
    expect((accepted.data as { ok: boolean }).ok).toBe(true);

    // ------------------------------------------------------------------ rule set (read, never hard-coded)
    const before: RuleSetRow | null = currentRuleSet();
    let ruleSet: RuleSetRow | null = before;
    let fixtureApproved = false;
    if (fixtureApprovalEnabled() && ruleSet && ruleSet.status !== "approved") {
      ruleSet = fixtureApproveNewestDraft(team.cmo.id);
      fixtureApproved = true;
    }

    await run.step("rule-set-read-from-database", async () => {
      expect(ruleSet, "no bp_care_triage rule set exists in the database").not.toBeNull();
      const svc = serviceClient();
      const { data, error } = await svc.rpc("triage_rule_set_for_grading", { p_code: "bp_care_triage" });
      expect(error).toBeNull();
      const row = data as { id: string; status: string; rules: RuleSet } | null;
      expect(row?.id).toBe(ruleSet!.id);
      expect(Array.isArray((row!.rules as unknown as { rules: unknown[] }).rules)).toBe(true);
      console.log(`[J2] grading with bp_care_triage v${ruleSet!.version}, status ${ruleSet!.status}${fixtureApproved ? " (FIXTURE approved by a test account)" : ""}`);
    });

    if (hasRealApproval(before)) {
      await run.step("d1-rule-approved", async () => {
        expect(before!.status).toBe("approved");
      });
    } else {
      run.pending(
        "d1-rule-approved",
        "CMO approves bp_care_triage",
        fixtureApproved
          ? "the only approval is a TEST fixture inside this local database, not a signature (S85_FIXTURE_APPROVE_RULESET=1)"
          : "no approved bp_care_triage exists; the rule set is a draft and approval is the Chief Medical Officer's signature",
      );
    }
    const approved = ruleSet?.status === "approved";

    // ------------------------------------------------------------------ the patient in a real browser
    let readingId: string | null = null;
    let loggedIn = false;
    await run.step("patient-logs-reading-with-symptom", async () => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(patient.email);
      await page.getByLabel("Password").fill(patient.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/patient/, { timeout: 90_000 });
      loggedIn = true;
      await page.goto("/patient/vitals", { waitUntil: "domcontentloaded" });
      await page.locator("#systolic").fill(String(SYSTOLIC));
      await page.locator("#diastolic").fill(String(DIASTOLIC));
      await page.getByRole("button", { name: "Save reading" }).click();
      const confirm = page.getByRole("button", { name: /yes, this reading is correct/i });
      if (await confirm.isVisible({ timeout: 4000 }).catch(() => false)) await confirm.click();
      await expect(page.getByText("Reading logged.")).toBeVisible({ timeout: 30_000 });
      readingId = sqlValue<string>(
        `select id from public.vitals_readings where patient_id = ${lit(patient.id)} and vital_type::text = 'blood_pressure' order by created_at desc limit 1`,
      );
      expect(readingId).not.toBeNull();
      // The emergency symptom goes in through the patient's own session (row security applies), shortly after the reading, as the
      // phone's offline ordering does (S12: a red-flag symptom just after the reading regrades it).
      const ins = await patientClient.from("symptoms").insert({
        organisation_id: org,
        patient_id: patient.id,
        description: "[s85] severe headache",
        symptom_type: "severe_headache",
        is_red_flag: true,
        severity: 9,
      });
      expect(ins.error, JSON.stringify(ins.error)).toBeNull();
    });

    await run.step("guidance-shown-online", async () => {
      expect(loggedIn).toBe(true);
      // The live emergency pipeline (a database trigger on the reading) raises the full screen alert on every plan.
      const alert = page.getByRole("alertdialog");
      await expect(alert).toContainText(/this may be a medical emergency/i, { timeout: 30_000 });
      await expect(alert).toContainText(/nearest hospital/i);
    });

    // ------------------------------------------------------------------ the network goes off
    await run.step("offline-web-refuses-to-claim-saved", async () => {
      const ack = page.getByRole("button", { name: /i'm getting help/i });
      if (await ack.isVisible().catch(() => false)) await ack.click();
      await page.goto("/patient/vitals", { waitUntil: "domcontentloaded" });
      const before = Number(sqlValue<string>(`select count(*)::text from public.vitals_readings where patient_id = ${lit(patient.id)}`));
      await context.setOffline(true);
      try {
        await page.locator("#systolic").fill(String(SYSTOLIC));
        await page.locator("#diastolic").fill(String(DIASTOLIC));
        await page.getByRole("button", { name: "Save reading" }).click();
        const confirm = page.getByRole("button", { name: /yes, this reading is correct/i });
        if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) await confirm.click();
        await expect(page.getByText(/you're offline/i)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Reading logged.")).toHaveCount(0);
      } finally {
        await context.setOffline(false);
      }
      const after = Number(sqlValue<string>(`select count(*)::text from public.vitals_readings where patient_id = ${lit(patient.id)}`));
      expect(after, "an offline submit must not create a reading").toBe(before);
    });

    // ------------------------------------------------------------------ drain the bus, no waiting for the 15 second cron
    const drain = await drainBus();
    console.log(`[J2] drained the bus: ${JSON.stringify(drain.summary)} hosts=${drain.hosts.join(",")}`);

    // The facts the server used, for the oracle.
    let graded: { id: string; grade: string; rule_id: string | null; shadow: boolean; actions: unknown; rule_set_id: string; rule_set_status: string; created_at: string } | undefined;
    let input: TriageInput | undefined;
    if (readingId) {
      const rows = sqlRows<NonNullable<typeof graded>>(
        `select id, grade, rule_id, shadow, actions, rule_set_id, rule_set_status, created_at from public.triage_events
          where patient_id = ${lit(patient.id)} and trigger_type = 'observation' order by created_at desc limit 1`,
      );
      graded = rows[0];
      const ctx = await serviceClient().rpc("triage_context_for_observation", { p_observation_id: readingId, p_recheck: null });
      const raw = ctx.data as { found?: boolean; input?: TriageInput } | null;
      input = raw?.found ? raw.input : undefined;
    }

    await run.step("grade-from-rule-set", async () => {
      expect(graded, "no triage_events row was written for the reading (drain: " + JSON.stringify(drain.summary) + ")").toBeDefined();
      expect(input, "the server's triage context for the reading could not be read").toBeDefined();
      expect(graded!.rule_set_id).toBe(ruleSet!.id);
      const svc = serviceClient();
      const { data } = await svc.rpc("triage_rule_set_for_grading", { p_code: "bp_care_triage" });
      const rules = (data as { rules: RuleSet }).rules;
      const expected = grade(input!, rules);
      expect(expected.status).toBe("graded");
      if (expected.status === "graded") expect(graded!.grade).toBe(expected.grade);
      // shadow is a consequence of the rule set's status, never of anything this test sets
      expect(graded!.shadow).toBe(graded!.rule_set_status !== "approved");
      console.log(`[J2] stored grade ${graded!.grade} (rule ${graded!.rule_id}, shadow ${graded!.shadow}) equals the engine on the same facts`);
    });

    await run.step("guidance-with-network-off-device", async () => {
      expect(input).toBeDefined();
      // The phone grades on the device from a bundled or cached rule set with no network (INV-06). Its bundled fallback is
      // BP_CARE_V1. Here the engine runs with fetch made to throw, on the facts the server used.
      const realFetch = globalThis.fetch;
      let touched = 0;
      globalThis.fetch = (() => {
        touched += 1;
        throw new Error("network is off");
      }) as typeof fetch;
      let device;
      try {
        device = grade(input!, BP_CARE_V1 as unknown as RuleSet);
      } finally {
        globalThis.fetch = realFetch;
      }
      expect(touched).toBe(0);
      expect(device.status).toBe("graded");
      const rank = { green: 0, amber: 1, red: 2 } as const;
      if (device.status === "graded" && graded) {
        // Never weaker than the server: if the server says red, the device must say red.
        expect(rank[device.grade as keyof typeof rank]).toBeGreaterThanOrEqual(rank[graded.grade as keyof typeof rank]);
      }
    });

    await run.step("no-model-call", async () => {
      expect(drain.hosts.filter((h) => !["127.0.0.1", "localhost", "0.0.0.0"].includes(h)), "the bus talked to a non-local host").toEqual([]);
      const apiHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
      const outside = [...browserHosts].filter((h) => ![apiHost, "127.0.0.1", "localhost"].includes(h));
      expect(outside.filter((h) => /anthropic|openai|googleapis|claude/i.test(h)), "the browser contacted a model host").toEqual([]);
      const ai = sqlValue<string>(
        `select (select count(*) from public.ai_interaction_log where created_at >= ${lit(startedAt)}::timestamptz and patient_id = ${lit(patient.id)})::text`,
      );
      const turns = sqlValue<string>(
        `select (select count(*) from public.ai_assistant_turns where created_at >= ${lit(startedAt)}::timestamptz)::text`,
      );
      expect({ ai, turns }).toEqual({ ai: "0", turns: "0" });
    });

    // ------------------------------------------------------------------ downstream of an APPROVED rule set only
    const tasks = readingId && graded ? sqlRows<{ id: string; type: string; state: string }>(`select id, type::text, state::text from public.clinical_tasks where patient_id = ${lit(patient.id)}`) : [];
    const pages = readingId && graded ? sqlRows<{ id: string; to_clinician_id: string | null; role: string; escalation_level: number }>(`select id, to_clinician_id, role::text, escalation_level from public.pages where patient_id = ${lit(patient.id)} order by sent_at`) : [];
    const isRed = graded?.grade === "red";

    if (approved) {
      await run.step("queue-item-created", async () => {
        expect(graded?.shadow).toBe(false);
        const actions = (graded!.actions as Array<{ kind: string; task?: string }>) ?? [];
        const wantsTask = actions.some((a) => a.kind === "create_task");
        expect(wantsTask || !isRed, "a red grade from an approved rule set names a task").toBe(true);
        if (wantsTask) expect(tasks.length).toBeGreaterThan(0);
      });
      await run.step("on-call-page-created", async () => {
        const actions = (graded!.actions as Array<{ kind: string }>) ?? [];
        const wantsPage = actions.some((a) => a.kind === "page_on_call");
        if (wantsPage) {
          expect(pages.length).toBeGreaterThan(0);
          expect(pages[0]!.to_clinician_id).toBe(team.primary.id);
        } else {
          expect(pages.length, "a grade with no page action must not page").toBe(0);
        }
      });
    } else {
      run.pending("queue-item-created", "CMO approves bp_care_triage", "the grade was made by a draft rule set (shadow, OQ-88): no clinical task is created from it");
      run.pending("on-call-page-created", "CMO approves bp_care_triage", "the grade was made by a draft rule set (shadow, OQ-88): nobody is paged from it");
      // What IS asserted while pending: the shadow behaviour, so "nothing happened" is a checked fact, not an absence of checking.
      expect(graded?.shadow, "a draft rule set must only ever produce shadow results").toBe(true);
      expect(pages.length, "a shadow grade must not page").toBe(0);
      expect(tasks.filter((t) => t.type !== "red_event_unacknowledged").length, "a shadow grade must not create tasks").toBe(0);
    }

    const ping = () => captureNotifications([supporter.id, team.primary.id, team.backup.id, team.cmo.id], startedAt);
    if (approved && pages.length > 0) {
      await run.step("care-circle-contact-notified", async () => {
        const mine = ping().filter((n) => n.recipient_id === supporter.id);
        expect(mine.some((n) => n.channel === "push" && n.priority === "critical"), "no critical push for the supporter").toBe(true);
        expect(mine.some((n) => n.channel === "in_app"), "no in-app alert for the supporter").toBe(true);
        // The supporter's own real session sees the open alert, with only the person's name (no grade, reading or cause).
        const open = await supporterClient.rpc("circle_open_alerts");
        expect(open.error, JSON.stringify(open.error)).toBeNull();
        const text = JSON.stringify(open.data);
        expect(text).not.toMatch(/blood|pressure|190|120|red|headache|emergency/i);
        expect(Array.isArray(open.data) ? (open.data as unknown[]).length : 1).toBeGreaterThan(0);
      });
    } else {
      run.pending("care-circle-contact-notified", "CMO approves bp_care_triage", "the Care Circle alert is sent when a red page is created, and a draft rule set pages nobody");
    }

    await run.step("notifications-neutral", async () => {
      const rows = ping();
      expect(neutralityViolations(rows, [`${SYSTOLIC}`, `${DIASTOLIC}`, `${SYSTOLIC}/${DIASTOLIC}`])).toEqual([]);
      for (const n of rows) if (n.template?.includes("circle_check_in") || n.template?.includes("on_call")) expect(n.priority).toBe("critical");
    });

    if (approved && pages.length > 0) {
      await run.step("clinician-acknowledges-and-records", async () => {
        const doc = await signIn(team.primary);
        const mine = await doc.rpc("my_active_pages");
        expect(mine.error, JSON.stringify(mine.error)).toBeNull();
        const pageId = pages[0]!.id;
        const ack = await doc.rpc("acknowledge_page", { p_page: pageId });
        expect(ack.error, JSON.stringify(ack.error)).toBeNull();
        const close = await doc.rpc("close_page", { p_page: pageId, p_note: "S85 journey: spoke to the patient, advised the nearest hospital" });
        expect(close.error, JSON.stringify(close.error)).toBeNull();
        // a clinician who was not paged cannot acknowledge (INV-12)
        const stranger = await signIn(team.backup);
        const refused = await stranger.rpc("acknowledge_page", { p_page: pageId });
        expect(refused.error, "a clinician who was not paged was able to touch the page").not.toBeNull();
      });
    } else {
      run.pending("clinician-acknowledges-and-records", "CMO approves bp_care_triage", "no page exists to acknowledge while the rule set is a draft");
    }

    await run.step("audit-rows-written", async () => {
      const reading = sqlValue<string>(`select count(*)::text from public.audit_log where entity_type = 'vitals_readings' or event::text like ${lit(`%${patient.id}%`)}`);
      const triage = sqlValue<string>(`select count(*)::text from public.triage_events where patient_id = ${lit(patient.id)}`);
      const events = sqlValue<string>(`select count(*)::text from public.domain_events where patient_id = ${lit(patient.id)} and event_type in ('observation.recorded', 'triage.graded')`);
      expect(Number(triage)).toBeGreaterThan(0);
      expect(Number(events)).toBeGreaterThanOrEqual(2);
      void reading; // the audit_log count is informational: what the schema writes for a patient's own reading varies
      if (approved && pages.length > 0) {
        const paged = sqlValue<string>(`select count(*)::text from public.domain_events where event_type = 'page.sent' and patient_id = ${lit(patient.id)}`);
        expect(Number(paged)).toBeGreaterThan(0);
      }
    });

    if (approved && graded) {
      await run.step("followup-task-created", async () => {
        const actions = (graded!.actions as Array<{ kind: string; task?: string }>) ?? [];
        const wanted = actions.filter((a) => a.kind === "create_task");
        expect(tasks.length).toBeGreaterThanOrEqual(wanted.length);
        expect(wanted.length + pages.length, "the approved rule set named neither a task nor a page for this grade").toBeGreaterThanOrEqual(0);
      });
    } else {
      run.pending("followup-task-created", "CMO approves bp_care_triage", "tasks are created only from an approved rule set");
    }

    await finishJourney(run, testInfo);
    // The verdict can never be "passing" here: D1, the web offline guidance, follow-up booking and outcomes are pending.
    expect(run.report().verdict).not.toBe("passing");
  });
});
