"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { AddMedicationForm } from "./add-medication-form";

/**
 * "Add a medication" as a button that opens the form in a sheet, instead of a long form sitting on the page under the medicine list.
 * Today's doses is what this page is for; adding a medicine is an occasional job. The form keeps its own success message, so the
 * sheet stays open until the person closes it.
 */
export function AddMedicationSheet({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Plus className="mr-1.5 h-4 w-4" aria-hidden />
        Add a medication
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add a medication">
        <AddMedicationForm patientId={patientId} source="patient" />
      </Sheet>
    </>
  );
}
