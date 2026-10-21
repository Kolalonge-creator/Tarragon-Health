"use client";

import { t } from "@tarragon/i18n";
import { buildSharedRecordBundle, sharedBundleFileName } from "@/lib/my-health/share-fhir";
import type { SharedData } from "./shared-record-view";

/**
 * Saves what is already on the page as a FHIR file a hospital system can import. It is built in the browser from the record the recipient has
 * already opened, so it makes no second request: a download never counts as another view of a capped link and never touches the database.
 */
export function FhirDownloadButton({ record }: { record: SharedData }) {
  function download() {
    const { bundle } = buildSharedRecordBundle(record);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sharedBundleFileName(record);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      type="button"
      onClick={download}
      className="mt-3 ml-2 rounded-md border border-charcoal-ink/20 px-3 py-1.5 text-sm text-charcoal-ink hover:bg-charcoal-ink/5 print:hidden"
    >
      {t("sharelink.fhir.download")}
    </button>
  );
}
