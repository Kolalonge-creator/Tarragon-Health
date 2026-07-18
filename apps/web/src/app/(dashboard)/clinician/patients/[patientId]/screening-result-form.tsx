"use client";

import { useActionState, useState } from "react";
import { submitScreeningResult } from "./screening-result-actions";
import {
  ANALYTE_SCREEN_TYPES,
  QUALITATIVE_SCREEN_TYPES,
  GENOTYPE_SCREEN_TYPES,
  SCREENING_RESULT_SCREEN_TYPES,
} from "@/lib/validation/screening-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SCREEN_TYPE_LABELS: Record<(typeof SCREENING_RESULT_SCREEN_TYPES)[number], string> = {
  hba1c: "HbA1c",
  lipid_panel: "Lipid panel",
  psa: "PSA",
  hiv: "HIV",
  hep_b: "Hepatitis B",
  hep_c: "Hepatitis C",
  tb_screen: "TB screen",
  malaria_rdt: "Malaria RDT",
  sickle_cell_genotype: "Sickle cell genotype",
  mammography: "Mammography",
  cervical_smear: "Cervical smear",
  fit: "FIT (colorectal)",
  clinical_breast_exam: "Clinical breast exam",
  bone_density: "Bone density scan",
  colonoscopy: "Colonoscopy",
  vision_check: "Vision check",
};

type ScreenType = (typeof SCREENING_RESULT_SCREEN_TYPES)[number];

function groupOf(screenType: ScreenType): "analyte" | "qualitative" | "genotype" | "procedural" {
  if ((ANALYTE_SCREEN_TYPES as readonly string[]).includes(screenType)) return "analyte";
  if ((QUALITATIVE_SCREEN_TYPES as readonly string[]).includes(screenType)) return "qualitative";
  if ((GENOTYPE_SCREEN_TYPES as readonly string[]).includes(screenType)) return "genotype";
  return "procedural";
}

export function ScreeningResultForm({ patientId }: { patientId: string }) {
  const [screenType, setScreenType] = useState<ScreenType>("hba1c");
  const [state, formAction, pending] = useActionState(
    submitScreeningResult.bind(null, patientId),
    undefined
  );
  const group = groupOf(screenType);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a screening/lab result</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="screen_type_code">Screening type</Label>
            <Select
              id="screen_type_code"
              name="screen_type_code"
              value={screenType}
              onChange={(event) => setScreenType(event.target.value as ScreenType)}
            >
              {SCREENING_RESULT_SCREEN_TYPES.map((code) => (
                <option key={code} value={code}>
                  {SCREEN_TYPE_LABELS[code]}
                </option>
              ))}
            </Select>
          </div>

          {screenType === "hba1c" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="hba1c_value">HbA1c value</Label>
                <Input id="hba1c_value" name="hba1c_value" type="number" step="0.1" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hba1c_unit">Unit</Label>
                <Select id="hba1c_unit" name="hba1c_unit" defaultValue="percent">
                  <option value="percent">% (NGSP)</option>
                  <option value="mmol_mol">mmol/mol (IFCC)</option>
                </Select>
              </div>
            </div>
          )}

          {screenType === "psa" && (
            <div className="space-y-1.5">
              <Label htmlFor="psa_value">PSA value (ng/mL)</Label>
              <Input id="psa_value" name="psa_value" type="number" step="0.1" required />
            </div>
          )}

          {screenType === "lipid_panel" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="total_cholesterol_mg_dl">Total cholesterol (mg/dL)</Label>
                <Input id="total_cholesterol_mg_dl" name="total_cholesterol_mg_dl" type="number" step="1" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hdl_cholesterol_mg_dl">HDL cholesterol (mg/dL)</Label>
                <Input id="hdl_cholesterol_mg_dl" name="hdl_cholesterol_mg_dl" type="number" step="1" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ldl_cholesterol_mg_dl">LDL cholesterol (mg/dL, optional)</Label>
                <Input id="ldl_cholesterol_mg_dl" name="ldl_cholesterol_mg_dl" type="number" step="1" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="triglycerides_mg_dl">Triglycerides (mg/dL, optional)</Label>
                <Input id="triglycerides_mg_dl" name="triglycerides_mg_dl" type="number" step="1" />
              </div>
            </div>
          )}

          {group === "qualitative" && (
            <div className="space-y-1.5">
              <Label htmlFor="qualitative_result">Result</Label>
              <Select id="qualitative_result" name="qualitative_result" defaultValue="negative">
                <option value="negative">Negative</option>
                <option value="positive">Positive</option>
              </Select>
            </div>
          )}

          {group === "genotype" && (
            <div className="space-y-1.5">
              <Label htmlFor="genotype">Genotype</Label>
              <Input id="genotype" name="genotype" placeholder="e.g. AA, AS, SS" required />
            </div>
          )}

          {group === "procedural" && (
            <div className="space-y-1.5">
              <Label htmlFor="procedural_status">Result status</Label>
              <Select id="procedural_status" name="procedural_status" defaultValue="normal">
                <option value="normal">Normal</option>
                <option value="borderline">Borderline</option>
                <option value="abnormal">Abnormal</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
          )}

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Result recorded.</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Record result"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
