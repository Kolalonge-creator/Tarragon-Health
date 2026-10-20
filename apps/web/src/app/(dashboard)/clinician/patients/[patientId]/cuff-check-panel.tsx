import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CuffCheckForm } from "./cuff-check-form";

const KIND_LABEL: Record<string, string> = {
  home_higher: "The patient's cuff reads higher than the clinic cuff",
  home_lower: "The patient's cuff reads lower than the clinic cuff",
};

const SOURCE_LABEL: Record<string, string> = {
  same_visit: "Same visit",
  home_log: "Home log around a clinic reading",
};

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Home cuff vs clinic cuff (S07y), clinician-only. Shows the flags the rule has raised and the recent pairs, and the form for a same-visit pair. A read that fails or is
 * refused says so; it never reads as "no pairs". Nothing here is shown to the patient, and the flag only suggests considering a cuff check.
 */
export async function CuffCheckPanel({ patientId, canRecord }: { patientId: string; canRecord: boolean }) {
  const supabase = await createClient();
  const [pairsRes, flagsRes] = await Promise.all([
    supabase
      .from("cuff_check_pairs")
      .select("id, source, measured_at, d_systolic, d_diastolic, own_readings, device_label")
      .eq("patient_id", patientId)
      .order("measured_at", { ascending: false })
      .limit(8),
    supabase
      .from("cuff_check_flags")
      .select("id, kind, pairs_used, matching, created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);
  const failed = pairsRes.error !== null || flagsRes.error !== null;
  const pairs = pairsRes.data ?? [];
  const flags = flagsRes.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Home cuff vs clinic cuff</CardTitle>
        <CardDescription>
          Pairs of a clinic reading and a reading from the patient&apos;s own cuff. If the own cuff reads differently, in the same direction, across enough pairs, you are
          asked to consider a cuff check. For the care team only; never shown to the patient.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {failed ? (
          <p role="alert" className="text-sm text-charcoal-ink/70">
            The pairs could not be loaded just now. Do not assume there are none.
          </p>
        ) : null}
        {flags.length > 0 ? (
          <ul className="space-y-1">
            {flags.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="amber">Consider a cuff check</Badge>
                <span>
                  {KIND_LABEL[f.kind] ?? f.kind}: {f.matching} of the last {f.pairs_used} pairs, flagged {new Date(f.created_at).toLocaleDateString("en-NG")}.
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {!failed && pairs.length === 0 ? <p className="text-sm text-charcoal-ink/60">No pairs recorded yet.</p> : null}
        {pairs.length > 0 ? (
          <table className="w-full text-sm">
            <caption className="sr-only">Recent pairs, patient&apos;s cuff minus clinic cuff</caption>
            <thead>
              <tr className="text-left text-charcoal-ink/60">
                <th scope="col" className="py-1 pr-3 font-normal">When</th>
                <th scope="col" className="pr-3 font-normal">How</th>
                <th scope="col" className="pr-3 font-normal">Own minus clinic</th>
                <th scope="col" className="font-normal">Cuff</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-1 pr-3">{new Date(p.measured_at).toLocaleDateString("en-NG")}</td>
                  <td className="pr-3">{SOURCE_LABEL[p.source] ?? p.source}{p.source === "home_log" ? ` (${p.own_readings} readings)` : ""}</td>
                  <td className="pr-3">{signed(p.d_systolic)} / {signed(p.d_diastolic)} mmHg</td>
                  <td>{p.device_label ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {canRecord ? <CuffCheckForm patientId={patientId} /> : null}
      </CardContent>
    </Card>
  );
}
