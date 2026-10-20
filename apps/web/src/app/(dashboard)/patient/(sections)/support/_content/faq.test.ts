import { getProposedConfig } from "@tarragon/shared";
import { formatKobo } from "@/lib/format-money";
import { SUPPORT_FAQS } from "./faq";

describe("the data-cost answer in the patient FAQ (S06z)", () => {
  const entry = SUPPORT_FAQS.find((f) => /mobile data/i.test(f.question));

  it("is there", () => {
    expect(entry).toBeDefined();
  });

  it("quotes the configured price per megabyte and the configured Wi-Fi hold, never a typed-in number", () => {
    const config = getProposedConfig<{ readonly price_per_mb_kobo: number; readonly max_hold_hours: number }>("offline.data_cost").value;
    const naira = config.price_per_mb_kobo / 100;
    expect(entry?.answer).toContain(`₦${naira % 1 === 0 ? naira : naira.toFixed(2)}`);
    expect(entry?.answer).toContain(`${config.max_hold_hours} hours`);
  });

  it("calls the cost an estimate and says urgent entries are never delayed, with no em dash", () => {
    expect(entry?.answer).toMatch(/estimate/i);
    expect(entry?.answer).toMatch(/straight away/i);
    expect(`${entry?.question}${entry?.answer}`).not.toMatch(/—|–/);
  });
});
