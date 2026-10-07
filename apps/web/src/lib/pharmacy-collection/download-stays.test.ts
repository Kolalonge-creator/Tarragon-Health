/**
 * S28 standing guard: the downloadable prescription form stays available for ANY pharmacy, whatever collection is doing.
 *
 * The PDF is built from the medicine record (medications) and the clinician's signature. Pharmacy collection lives on the separate
 * prescriptions row. These checks keep it that way: no part of the download path may read the collection state, the go-live guard or
 * the module flag, so switching collection off, a pharmacy failing, or a patient never choosing a pharmacy can never remove the form.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(WEB, rel), "utf8");

const DOWNLOAD_PATH = [
  "app/api/patient/prescriptions/pdf/route.ts",
  "app/api/patient/prescriptions/[medicationId]/pdf/route.ts",
  "app/api/mobile/prescriptions/pdf/route.ts",
  "app/api/mobile/prescriptions/[medicationId]/pdf/route.ts",
  "app/(dashboard)/patient/prescription-download.tsx",
  "lib/prescriptions/load-prescription-pdf-data.ts",
  "lib/prescriptions/prescription-pdf-data.ts",
  "lib/prescriptions/prescription-pdf-response.ts",
];
const COLLECTION = /pharmacy_collection|collection_code|pharmacy_partner_id|pharmacy-collection|go_live|prescribing_enabled|prescription_pharmacy_events|rx_routing/;

describe("the downloadable prescription form stays for any pharmacy (S28)", () => {
  it.each(DOWNLOAD_PATH)("%s does not depend on pharmacy collection", (file) => {
    expect(read(file)).not.toMatch(COLLECTION);
  });

  it("the Medicines screen shows the medicines list (and its download) whether or not the collection card loads", () => {
    const page = read("app/(dashboard)/patient/(sections)/medications/page.tsx");
    // the list is rendered at the top level of the page, outside every collection conditional
    const withoutCollectionBlocks = page.replace(/\{collection\?\.ok === (true|false) && \([\s\S]*?\)\}/g, "");
    expect(withoutCollectionBlocks).toContain("<MedicationsList");
    expect(page).toMatch(/collection\?\.ok === false && <LoadErrorCard/); // a failed card shows an error, it does not blank the page
  });

  it("each medicine card offers the download (the existing component, unchanged by S28)", () => {
    expect(read("app/(dashboard)/patient/medications-list.tsx")).toContain("<PrescriptionDownload");
  });

  it("the card says so out loud", () => {
    const en = read("../../../packages/i18n/src/en.ts");
    expect(en).toMatch(/"pharmacy\.any_pharmacy": "Take the downloaded form to any pharmacy"/);
  });
});
