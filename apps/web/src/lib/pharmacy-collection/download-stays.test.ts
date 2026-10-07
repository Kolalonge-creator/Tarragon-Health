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
    "lib/prescriptions/load-prescription-pdf-data.ts",
  "lib/prescriptions/prescription-pdf-data.ts",
  "lib/prescriptions/prescription-pdf-response.ts",
];
const COLLECTION = /pharmacy_collection|collection_code|pharmacy_partner_id|pharmacy-collection|go_live|prescribing_enabled|prescription_collection_codes|rx_route|patient_choose_pharmacy/;

describe("the downloadable prescription form stays for any pharmacy (S28)", () => {
  it.each(DOWNLOAD_PATH)("%s does not depend on pharmacy collection", (file) => {
    expect(read(file)).not.toMatch(COLLECTION);
  });

  it("the download link and the collect link sit side by side: the collect link is added, never in place of the download", () => {
    const src = read("app/(dashboard)/patient/prescription-download.tsx");
    expect(src).toContain("Download prescription (PDF)");
    expect(src).toContain("Choose where to collect");
    // the PDF anchor is not conditional on a prescription row or on collection being open
    const pdfIndex = src.indexOf("Download prescription (PDF)");
    const collectIndex = src.indexOf("Choose where to collect");
    expect(pdfIndex).toBeLessThan(collectIndex);
    expect(src).not.toMatch(/pharmacy_collection_on|go_live|prescribing_enabled/);
  });

  it("each medicine card offers the download (the existing component, unchanged by S28)", () => {
    expect(read("app/(dashboard)/patient/medications-list.tsx")).toContain("<PrescriptionDownload");
  });

  it("the collect page says so out loud when collection is not open, so the form is never the only thing offered", () => {
    const en = read("../../../packages/i18n/src/en.ts");
    expect(en).toMatch(/"pharmcollect\.off": "[^"]*download your prescription and take it to any pharmacy/);
    expect(en).toMatch(/"pharmcollect\.none": "[^"]*download your prescription/);
  });
});
