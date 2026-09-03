"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  useCase,
  useAssignCaseManager,
  useCloseCase,
  useReopenCase,
  useEscalateCase,
  useCaseGoals,
  useAddCaseGoal,
  useUpdateCaseGoalStatus,
  useCasePlanItems,
  useAddCasePlanItem,
  useRecordPlanItemOutcome,
  useRemoveCasePlanItem,
  useCaseBarriers,
  useAddBarrier,
  useResolveBarrier,
  useCaseEvents,
  type CaseRow,
  type CaseBarrier,
} from "@/lib/queries/care-management";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

const STATUS_BADGE: Record<CaseRow["status"], { label: string; variant: BadgeProps["variant"] }> = {
  active: { label: "Active", variant: "green" },
  closed: { label: "Closed", variant: "grey" },
};

const ENTRY_REASON_LABEL: Record<CaseRow["entry_reason"], string> = {
  risk_engine: "Risk engine",
  clinician_referral: "Clinician referral",
  hospital_discharge: "Hospital discharge",
  repeated_alerts: "Repeated alerts",
  care_coordinator_escalation: "Care coordinator escalation",
};

const BARRIER_CATEGORY_LABEL: Record<CaseBarrier["category"], string> = {
  financial: "Financial",
  transport: "Transport",
  health_literacy: "Health literacy",
  social_support: "Social support",
  access: "Access",
  other: "Other",
};

export function CaseDetail({ caseId, canClose }: { caseId: string; canClose: boolean }) {
  const { data: caseRow, isLoading, isError } = useCase(caseId);

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !caseRow) return <p className="text-sm text-red-600">Could not load this case.</p>;

  return (
    <div className="space-y-6">
      <CaseHeader caseRow={caseRow} canClose={canClose} />
      <CaseFilePanel patientId={caseRow.patient_id} organisationId={caseRow.organisation_id} />
      <GoalsSection caseId={caseId} organisationId={caseRow.organisation_id} patientId={caseRow.patient_id} />
      <PlanItemsSection caseId={caseId} organisationId={caseRow.organisation_id} patientId={caseRow.patient_id} />
      <BarriersSection caseId={caseId} organisationId={caseRow.organisation_id} patientId={caseRow.patient_id} />
      <EscalationSection
        caseId={caseId}
        organisationId={caseRow.organisation_id}
        patientId={caseRow.patient_id}
      />
      <TimelineSection caseId={caseId} />
    </div>
  );
}

function CaseHeader({ caseRow, canClose }: { caseRow: NonNullable<ReturnType<typeof useCase>["data"]>; canClose: boolean }) {
  const closeCase = useCloseCase();
  const reopenCase = useReopenCase();
  const assignManager = useAssignCaseManager();
  const [closureSummary, setClosureSummary] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [showClose, setShowClose] = useState(false);
  const [showReopen, setShowReopen] = useState(false);

  const { data: staffOptions } = useQuery({
    queryKey: ["care-management", "clinical-staff-options", caseRow.organisation_id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff")
        .select("id, full_name")
        .eq("organisation_id", caseRow.organisation_id)
        .eq("active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{caseRow.patient?.full_name ?? "Unknown patient"}</CardTitle>
          <Badge variant={STATUS_BADGE[caseRow.status].variant}>{STATUS_BADGE[caseRow.status].label}</Badge>
        </div>
        <CardDescription>
          Entered via {ENTRY_REASON_LABEL[caseRow.entry_reason]} on{" "}
          {new Date(caseRow.opened_at).toLocaleDateString()}
          {caseRow.entry_detail ? ` — ${caseRow.entry_detail}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
            Case manager
          </span>
          <Select
            className="h-8 w-56 text-xs"
            value={caseRow.case_manager_id ?? ""}
            onChange={(event) =>
              assignManager.mutate({ caseId: caseRow.id, caseManagerId: event.target.value || null })
            }
          >
            <option value="">Unassigned</option>
            {(staffOptions ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </Select>
        </div>

        {caseRow.status === "active" && (
          <div className="border-t border-charcoal-ink/10 pt-3">
            {!showClose ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setShowClose(true)}>
                Close case
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-charcoal-ink/60">
                  Closing requires every goal achieved/abandoned, every case plan item outcome
                  recorded, and every barrier resolved (74.14).
                  {!canClose && " Only an active clinical-tier staff member may close a case."}
                </p>
                <Textarea
                  value={closureSummary}
                  onChange={(event) => setClosureSummary(event.target.value)}
                  placeholder="Closure summary — why this case is closing"
                  className="text-xs"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canClose || closeCase.isPending || !closureSummary.trim()}
                    onClick={() => closeCase.mutate({ caseId: caseRow.id, closureSummary: closureSummary.trim() })}
                  >
                    Confirm close
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowClose(false)}>
                    Cancel
                  </Button>
                </div>
                {closeCase.isError && (
                  <p className="text-xs text-red-600">{(closeCase.error as Error).message}</p>
                )}
              </div>
            )}
          </div>
        )}

        {caseRow.status === "closed" && (
          <div className="border-t border-charcoal-ink/10 pt-3 space-y-2">
            {caseRow.closure_summary && (
              <p className="text-xs text-charcoal-ink/60">Closure summary: {caseRow.closure_summary}</p>
            )}
            {!showReopen ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setShowReopen(true)}>
                Reopen case
              </Button>
            ) : (
              <div className="space-y-2">
                <Textarea
                  value={reopenReason}
                  onChange={(event) => setReopenReason(event.target.value)}
                  placeholder="Reason for reopening — deterioration, new admission, repeated abnormal results, clinician referral (74.15)"
                  className="text-xs"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={reopenCase.isPending || !reopenReason.trim()}
                    onClick={() =>
                      reopenCase.mutate(
                        { caseId: caseRow.id, reason: reopenReason.trim() },
                        { onSuccess: () => setShowReopen(false) },
                      )
                    }
                  >
                    Confirm reopen
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowReopen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 74.4 case file — read live from each table's own canonical source, never duplicated. */
function CaseFilePanel({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const supabase = createClient();
  const { data: conditions } = useQuery({
    queryKey: ["care-management", "case-file", "conditions", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_conditions")
        .select("id, condition_name, status")
        .eq("patient_id", patientId)
        .order("date_identified", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: medications } = useQuery({
    queryKey: ["care-management", "case-file", "medications", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("medications")
        .select("id, drug_name, dose, frequency")
        .eq("patient_id", patientId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });
  const { data: labOrders } = useQuery({
    queryKey: ["care-management", "case-file", "lab-orders", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lab_orders")
        .select("id, status, ordered_at")
        .eq("patient_id", patientId)
        .order("ordered_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });
  const { data: referrals } = useQuery({
    queryKey: ["care-management", "case-file", "referrals", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("specialist_referrals")
        .select("id, specialist_type, status")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });
  const { data: admissions } = useQuery({
    queryKey: ["care-management", "case-file", "admissions", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_hospital_admissions")
        .select("id, admitted_on, discharged_on, facility_name")
        .eq("patient_id", patientId)
        .order("admitted_on", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Case file</CardTitle>
        <CardDescription>Live from the patient&apos;s record — nothing here is duplicated.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <CaseFileList
          title="Conditions"
          items={(conditions ?? []).map((c) => `${c.condition_name} (${c.status})`)}
          organisationId={organisationId}
        />
        <CaseFileList
          title="Medications"
          items={(medications ?? []).map((m) => `${m.drug_name}${m.dose ? " " + m.dose : ""}${m.frequency ? " — " + m.frequency : ""}`)}
        />
        <CaseFileList
          title="Investigations"
          items={(labOrders ?? []).map((l) => `Ordered ${new Date(l.ordered_at).toLocaleDateString()} (${l.status})`)}
        />
        <CaseFileList
          title="Specialists"
          items={(referrals ?? []).map((r) => `${r.specialist_type} (${r.status})`)}
        />
        <CaseFileList
          title="Hospitalisations"
          items={(admissions ?? []).map(
            (a) =>
              `${a.facility_name ?? "Unnamed facility"}: ${new Date(a.admitted_on).toLocaleDateString()}${
                a.discharged_on ? ` – ${new Date(a.discharged_on).toLocaleDateString()}` : " (current)"
              }`,
          )}
        />
      </CardContent>
    </Card>
  );
}

function CaseFileList({ title, items }: { title: string; items: string[]; organisationId?: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-charcoal-ink/40">None on file.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {items.map((item, i) => (
            <li key={i} className="text-sm text-charcoal-ink">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 74.5: measurable case goals. */
function GoalsSection({ caseId, organisationId, patientId }: { caseId: string; organisationId: string; patientId: string }) {
  const { data: goals } = useCaseGoals(caseId);
  const addGoal = useAddCaseGoal();
  const updateStatus = useUpdateCaseGoalStatus();
  const [newGoal, setNewGoal] = useState("");

  const open = (goals ?? []).filter((g) => g.status === "open");
  const resolved = (goals ?? []).filter((g) => g.status !== "open");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Care goals</CardTitle>
        <CardDescription>
          Should be measurable, e.g. &ldquo;Reduce average BP toward agreed clinical target.&rdquo;
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {open.length === 0 && resolved.length === 0 && (
          <p className="text-xs text-charcoal-ink/50">No goals set yet.</p>
        )}
        {open.map((goal) => (
          <div key={goal.id} className="flex items-center justify-between gap-2 text-sm">
            <span>{goal.description}</span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                className="text-xs text-brand-green hover:underline"
                onClick={() => updateStatus.mutate({ goalId: goal.id, caseId, status: "achieved" })}
              >
                Achieved
              </button>
              <button
                type="button"
                className="text-xs text-charcoal-ink/40 hover:text-red-600"
                onClick={() => updateStatus.mutate({ goalId: goal.id, caseId, status: "abandoned" })}
              >
                Abandon
              </button>
            </span>
          </div>
        ))}
        {resolved.map((goal) => (
          <p key={goal.id} className="text-xs text-charcoal-ink/40 line-through">
            {goal.description} ({goal.status})
          </p>
        ))}
        <div className="flex gap-2 pt-1">
          <Input
            value={newGoal}
            onChange={(event) => setNewGoal(event.target.value)}
            placeholder="Add a case goal"
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-3 text-xs"
            disabled={addGoal.isPending || !newGoal.trim()}
            onClick={() =>
              addGoal.mutate(
                { caseId, organisationId, patientId, description: newGoal.trim() },
                { onSuccess: () => setNewGoal("") },
              )
            }
          >
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** 74.6: Problem -> Goal -> Intervention -> Owner -> Deadline -> Outcome. */
function PlanItemsSection({ caseId, organisationId, patientId }: { caseId: string; organisationId: string; patientId: string }) {
  const { data: items } = useCasePlanItems(caseId);
  const { data: goals } = useCaseGoals(caseId);
  const addItem = useAddCasePlanItem();
  const recordOutcome = useRecordPlanItemOutcome();
  const removeItem = useRemoveCasePlanItem();
  const [problem, setProblem] = useState("");
  const [goalId, setGoalId] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [outcomeDraft, setOutcomeDraft] = useState<Record<string, string>>({});

  const active = (items ?? []).filter((i) => i.status === "active");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Case plan</CardTitle>
        <CardDescription>Problem → Goal → Intervention → Owner → Deadline → Outcome.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.length === 0 && <p className="text-xs text-charcoal-ink/50">No case plan items yet.</p>}
        {active.map((item) => (
          <div key={item.id} className="rounded-md border border-charcoal-ink/10 p-3 text-sm space-y-1.5">
            {item.problem && <p className="font-medium text-charcoal-ink">{item.problem}</p>}
            <p className="text-charcoal-ink/80">{item.description}</p>
            <p className="text-xs text-charcoal-ink/50">
              {item.deadline ? `Due ${new Date(item.deadline).toLocaleDateString()}` : "No deadline set"}
              {item.outcome ? ` · Outcome recorded: ${item.outcome}` : ""}
            </p>
            {!item.outcome && (
              <div className="flex gap-2 pt-1">
                <Input
                  value={outcomeDraft[item.id] ?? ""}
                  onChange={(event) => setOutcomeDraft((prev) => ({ ...prev, [item.id]: event.target.value }))}
                  placeholder="Record outcome"
                  className="h-8 text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 px-3 text-xs"
                  disabled={recordOutcome.isPending || !(outcomeDraft[item.id] ?? "").trim()}
                  onClick={() =>
                    recordOutcome.mutate({ itemId: item.id, caseId, outcome: (outcomeDraft[item.id] ?? "").trim() })
                  }
                >
                  Save outcome
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 shrink-0 px-2 text-xs text-charcoal-ink/40 hover:text-red-600"
                  onClick={() => removeItem.mutate({ itemId: item.id, caseId })}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
        ))}

        <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
          <Input value={problem} onChange={(event) => setProblem(event.target.value)} placeholder="Problem" className="h-8 text-xs" />
          <Select value={goalId} onChange={(event) => setGoalId(event.target.value)} className="h-8 text-xs">
            <option value="">No linked goal</option>
            {(goals ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.description}
              </option>
            ))}
          </Select>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Intervention"
            className="h-8 text-xs"
          />
          <div className="flex gap-2">
            <Input
              type="date"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              className="h-8 w-40 text-xs"
            />
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 px-3 text-xs"
              disabled={addItem.isPending || !description.trim()}
              onClick={() =>
                addItem.mutate(
                  {
                    caseId,
                    organisationId,
                    patientId,
                    problem: problem.trim() || null,
                    goalId: goalId || null,
                    description: description.trim(),
                    ownerId: null,
                    deadline: deadline || null,
                  },
                  {
                    onSuccess: () => {
                      setProblem("");
                      setGoalId("");
                      setDescription("");
                      setDeadline("");
                    },
                  },
                )
              }
            >
              Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BarriersSection({ caseId, organisationId, patientId }: { caseId: string; organisationId: string; patientId: string }) {
  const { data: barriers } = useCaseBarriers(caseId);
  const addBarrier = useAddBarrier();
  const resolveBarrier = useResolveBarrier();
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<CaseBarrier["category"]>("other");

  const open = (barriers ?? []).filter((b) => b.status === "open");
  const resolved = (barriers ?? []).filter((b) => b.status === "resolved");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Barriers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {open.length === 0 && resolved.length === 0 && (
          <p className="text-xs text-charcoal-ink/50">No barriers logged.</p>
        )}
        {open.map((b) => (
          <div key={b.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              <Badge variant="amber">{BARRIER_CATEGORY_LABEL[b.category]}</Badge> {b.description}
            </span>
            <button
              type="button"
              className="shrink-0 text-xs text-brand-green hover:underline"
              onClick={() => resolveBarrier.mutate({ barrierId: b.id, caseId })}
            >
              Resolve
            </button>
          </div>
        ))}
        {resolved.map((b) => (
          <p key={b.id} className="text-xs text-charcoal-ink/40 line-through">
            {b.description}
          </p>
        ))}
        <div className="flex gap-2 pt-1">
          <Select
            value={category}
            onChange={(event) => setCategory(event.target.value as CaseBarrier["category"])}
            className="h-8 w-40 text-xs"
          >
            {Object.entries(BARRIER_CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe the barrier"
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-3 text-xs"
            disabled={addBarrier.isPending || !description.trim()}
            onClick={() =>
              addBarrier.mutate(
                { caseId, organisationId, patientId, category, description: description.trim() },
                { onSuccess: () => setDescription("") },
              )
            }
          >
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** 74.13: Care coordinator/case manager -> clinician -> senior doctor -> specialist -> emergency. */
function EscalationSection({ caseId, organisationId, patientId }: { caseId: string; organisationId: string; patientId: string }) {
  const escalate = useEscalateCase();
  const [targetLevel, setTargetLevel] = useState<"clinician" | "senior_doctor" | "specialist" | "emergency">("clinician");
  const [reason, setReason] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Escalate this case</CardTitle>
        <CardDescription>
          Raises a case-linked alert through the existing escalation ladder — never claims or
          resolves anything on this patient&apos;s behalf.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Select
            value={targetLevel}
            onChange={(event) => setTargetLevel(event.target.value as typeof targetLevel)}
            className="h-8 w-48 text-xs"
          >
            <option value="clinician">Clinician review</option>
            <option value="senior_doctor">Senior doctor</option>
            <option value="specialist">Specialist referral</option>
            <option value="emergency">Emergency pathway</option>
          </Select>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for escalating"
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-3 text-xs"
            disabled={escalate.isPending || !reason.trim()}
            onClick={() =>
              escalate.mutate(
                { caseId, organisationId, patientId, targetLevel, reason: reason.trim() },
                { onSuccess: () => setReason("") },
              )
            }
          >
            Escalate
          </Button>
        </div>
        {escalate.isSuccess && <p className="text-xs text-brand-green">Escalation raised.</p>}
      </CardContent>
    </Card>
  );
}

function TimelineSection({ caseId }: { caseId: string }) {
  const { data: events } = useCaseEvents(caseId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {(events ?? []).length === 0 && <p className="text-xs text-charcoal-ink/50">No events yet.</p>}
        <ul className="space-y-1.5">
          {(events ?? []).map((event) => (
            <li key={event.id} className="text-xs text-charcoal-ink/70">
              <span className="font-medium text-charcoal-ink">{event.event_type}</span>{" "}
              {new Date(event.created_at).toLocaleString()}
              {event.reason ? ` — ${event.reason}` : ""}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
