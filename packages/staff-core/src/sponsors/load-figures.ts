import { parseStaffFigures, parseStaffProgrammes, type StaffMonth, type StaffProgrammes } from "./staff-figures";

export type LoadRpc = (fn: "sponsor_staff_programmes" | "sponsor_staff_figures", args?: { p_cohort: string }) => PromiseLike<{ data: unknown; error: unknown }>;
export type SponsorFiguresLoad =
  | { ok: false }
  | { ok: true; sponsor: string; programmes: { programme: StaffProgrammes["programmes"][number]; months: StaffMonth[] | null }[] };

/** A sponsor staff member's programmes with each one's frozen monthly figures. A failed read is a failure, never an empty list. */
export async function loadSponsorFigures(rpc: LoadRpc): Promise<SponsorFiguresLoad> {
  const progs = await rpc("sponsor_staff_programmes");
  const list = progs.error ? null : parseStaffProgrammes(progs.data);
  if (!list) return { ok: false };
  const programmes = await Promise.all(list.programmes.map(async (programme) => {
    const figs = await rpc("sponsor_staff_figures", { p_cohort: programme.id });
    return { programme, months: figs.error ? null : parseStaffFigures(figs.data) };
  }));
  return { ok: true, sponsor: list.sponsor, programmes };
}
