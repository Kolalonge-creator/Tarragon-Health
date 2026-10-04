"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NOT_FOUND_ON_DESK,
  canRecordFromDesk,
  describeNameCheck,
  deskVerdict,
  parseDeskResult,
  type DeskLookup,
} from "@/lib/prescriptions/desk";
import { SUPPLY_OUTCOME_MESSAGE, isSupplyOutcome, presentStatus } from "@/lib/prescriptions/public-verification";
import { stripDoctorTitle } from "@/lib/prescriptions/doctor-name";

const TONE_CLASS = {
  good: "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30",
  bad: "border-red-600 bg-red-50 dark:bg-red-950/30",
  neutral: "border-charcoal-ink/20 bg-charcoal-ink/5",
} as const;

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });
}

export function PrescriptionDeskConsole() {
  const [rx, setRx] = useState("");
  const [code, setCode] = useState("");
  const [nameOnPaper, setNameOnPaper] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [lookup, setLookup] = useState<DeskLookup | null>(null);

  const [pharmacy, setPharmacy] = useState("");
  const [pharmacist, setPharmacist] = useState("");
  const [registration, setRegistration] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordMessage, setRecordMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  async function runLookup() {
    setBusy(true);
    setError(null);
    setNotFound(false);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("desk_verify_prescription", {
      p_rx_number: rx.trim(),
      p_verification_code: code.trim(),
      ...(nameOnPaper.trim() ? { p_name_on_paper: nameOnPaper.trim() } : {}),
    });
    setBusy(false);
    if (rpcError) {
      setLookup(null);
      setError(rpcError.message);
      return;
    }
    const result = parseDeskResult(data);
    if (result.kind === "found") setLookup(result.lookup);
    else {
      setLookup(null);
      if (result.kind === "not_found") setNotFound(true);
      else setError(result.message);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setRecordMessage(null);
    void runLookup();
  }

  async function recordSupply(event: FormEvent) {
    event.preventDefault();
    setRecording(true);
    setRecordMessage(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("desk_record_prescription_supply", {
      p_rx_number: rx.trim(),
      p_verification_code: code.trim(),
      p_pharmacy_name: pharmacy.trim(),
      p_pharmacist_name: pharmacist.trim(),
      p_pharmacist_registration: registration.trim(),
    });
    setRecording(false);
    const outcome = Array.isArray(data) ? data[0]?.outcome : undefined;
    if (rpcError || !isSupplyOutcome(outcome)) {
      setRecordMessage({ tone: "bad", text: rpcError?.message ?? "That could not be recorded just now. Try again." });
      return;
    }
    setRecordMessage(SUPPLY_OUTCOME_MESSAGE[outcome]);
    if (outcome === "recorded") {
      setPharmacy("");
      setPharmacist("");
      setRegistration("");
      setConfirmed(false);
      await runLookup();
    }
  }

  const status = lookup ? presentStatus(lookup.status) : null;
  const nameCheck = lookup ? describeNameCheck(lookup) : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Look up a prescription</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="desk-rx">Rx number</Label>
              <Input id="desk-rx" required placeholder="TRG-RX-2026-000366" value={rx} onChange={(e) => setRx(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desk-code">Verification code</Label>
              <Input id="desk-code" required placeholder="6 characters" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desk-name">Patient name on the paper (optional)</Label>
              <Input id="desk-name" placeholder="As the pharmacist reads it" value={nameOnPaper} onChange={(e) => setNameOnPaper(e.target.value)} autoComplete="off" />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={busy || !rx.trim() || !code.trim()}>
                {busy ? "Checking…" : lookup ? "Check again" : "Check prescription"}
              </Button>
            </div>
          </form>
          {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
          {notFound && <p role="status" className="mt-4 rounded-md border-l-4 border-red-600 bg-red-50 p-3 text-sm dark:bg-red-950/30">{NOT_FOUND_ON_DESK}</p>}
        </CardContent>
      </Card>

      {lookup && status && nameCheck && (
        <Card>
          <CardHeader>
            <CardTitle>{status.headline}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p role="status" className={`rounded-md border-l-4 p-3 text-sm font-medium ${TONE_CLASS[status.tone]}`}>{deskVerdict(lookup)}</p>
            <p className={`rounded-md border-l-4 p-3 text-sm ${TONE_CLASS[nameCheck.tone]}`}>{nameCheck.text}</p>
            <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              {[
                ["Rx number", lookup.rx_number],
                ["Medicine", lookup.drug_name],
                ["Dose", lookup.dose],
                ["How often", lookup.frequency],
                ["Quantity", lookup.quantity],
                ["Duration", lookup.duration_days ? `${lookup.duration_days} days` : null],
                ["Repeats allowed", String(lookup.repeats_allowed)],
                ["Supplied", `${lookup.supplies_dispensed} of ${lookup.supplies_permitted} permitted${lookup.last_supplied_on ? `, last on ${formatDate(lookup.last_supplied_on)}` : ""}`],
                ["Signed", formatDate(lookup.signed_at)],
                ["Valid until", formatDate(lookup.expires_at)],
                ["Version", lookup.version > 1 ? `${lookup.version} (amended)` : "1"],
                ["Prescribed by", `Dr. ${stripDoctorTitle(lookup.prescriber_name)}`],
                ["Registration", lookup.prescriber_credential],
              ].map(([label, value]) =>
                value ? (
                  <div key={label} className="flex justify-between gap-4 border-b border-charcoal-ink/10 py-1">
                    <dt className="text-charcoal-ink/60">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ) : null,
              )}
            </dl>

            {canRecordFromDesk(lookup) && (
              <form onSubmit={recordSupply} className="space-y-3 rounded-md border border-charcoal-ink/15 p-4">
                <p className="text-sm font-medium">Record a supply for the pharmacy</p>
                <p className="text-xs text-charcoal-ink/60">
                  Only when the pharmacist says they are supplying this now. What they tell you is saved on the prescription and the patient is told straight away; it is not checked against a register.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="desk-pharmacy">Pharmacy name</Label>
                    <Input id="desk-pharmacy" required minLength={2} maxLength={120} value={pharmacy} onChange={(e) => setPharmacy(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="desk-pharmacist">Pharmacist&apos;s name</Label>
                    <Input id="desk-pharmacist" required minLength={2} maxLength={120} value={pharmacist} onChange={(e) => setPharmacist(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="desk-registration">Pharmacist registration number</Label>
                    <Input id="desk-registration" required minLength={3} maxLength={40} value={registration} onChange={(e) => setRegistration(e.target.value)} />
                  </div>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
                  <span>The pharmacist told me on the phone that they are supplying this prescription now.</span>
                </label>
                <Button type="submit" variant="outline" disabled={recording || !confirmed}>
                  {recording ? "Recording…" : "Record this supply"}
                </Button>
              </form>
            )}
            {recordMessage && (
              <p role="status" className={`rounded-md border-l-4 p-3 text-sm ${TONE_CLASS[recordMessage.tone]}`}>{recordMessage.text}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
