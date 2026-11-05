import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `public.audit_log` can only be read directly by its own actor and by an admin (see the audit_log_select narrowing migration).
 * Every other legitimate reader goes through a SECURITY DEFINER function that gates and trims what it returns. This scan fails
 * when application code adds a new direct `.from("audit_log").select(...)`: that read would silently return only the caller's own
 * rows (or nothing) for most roles, or, run on the service-role client, would bypass the gate entirely.
 *
 * Inserts that do not chain `.select()` are not reads. Add an entry below only with the reason the direct read is correct.
 */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");

type Allowed = { file: string; count: number; why: string };

const ALLOWED: Allowed[] = [
  {
    file: "apps/web/src/app/(dashboard)/clinician/patients/page.tsx",
    count: 1,
    why: "user session, filtered to actor_id = the caller and one action: the clinician's own recently viewed patients (own rows are always readable)",
  },
  {
    file: "apps/web/src/lib/service-navigation/actions.ts",
    count: 1,
    why: "service-role client, counts the caller's own daily service_navigation.query rows for a rate limit; no row content is returned",
  },
  {
    file: "apps/web/e2e-browser/pharmacy-counter-controlled-medicines.spec.ts",
    count: 1,
    why: "browser E2E assertion through the service-role admin client against a local stack; not production code",
  },
];

const SCAN_DIRS = [
  "apps/web/src",
  "apps/mobile/src",
  "apps/console/src",
  "supabase/functions",
  "packages/staff-core/src",
  "packages/shared/src",
  "packages/ui/src",
  "packages/auth/src",
  "packages/notifications/src",
  "apps/web/e2e",
  "apps/web/e2e-browser",
];

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry === "node_modules" || entry === ".next") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/database\.types\.ts$/.test(entry) ? [full] : [];
  });
}

/** Every `.from("audit_log")`. A use is fine only when it is an `.insert(...)` statement that does not chain `.select(` (RETURNING needs the SELECT policy). */
const FROM_AUDIT = /\.from\(\s*["'`](?:public\.)?audit_log["'`]\s*\)/g;

function isReader(text: string, endOfFrom: number): boolean {
  const rest = text.slice(endOfFrom);
  if (!/^\s*\.insert\s*\(/.test(rest)) return true; // select, update, a bare table handle, or anything else
  const statement = rest.split(";")[0] ?? "";
  return /\.select\s*\(/.test(statement);
}

function findReads(): { file: string; line: number }[] {
  const hits: { file: string; line: number }[] = [];
  for (const dir of SCAN_DIRS) {
    for (const full of sourceFiles(join(REPO_ROOT, dir))) {
      const text = readFileSync(full, "utf8");
      for (const m of text.matchAll(FROM_AUDIT)) {
        if (isReader(text, (m.index ?? 0) + m[0].length)) {
          hits.push({ file: relative(REPO_ROOT, full), line: text.slice(0, m.index).split("\n").length });
        }
      }
    }
  }
  return hits;
}

describe("audit_log: no new direct reader outside the allow list", () => {
  const hits = findReads();

  it("only the listed files read audit_log directly, at most the listed number of times", () => {
    const counts = new Map<string, number>();
    for (const h of hits) counts.set(h.file, (counts.get(h.file) ?? 0) + 1);
    const offenders: string[] = [];
    for (const [file, n] of counts) {
      const allowed = ALLOWED.filter((a) => a.file === file).reduce((s, a) => s + a.count, 0);
      if (n > allowed) offenders.push(`${file}: ${n} direct audit_log read(s), ${allowed} listed`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the allow list honest: every entry still exists", () => {
    const stale = ALLOWED.filter((a) => hits.filter((h) => h.file === a.file).length < a.count).map((a) => a.file);
    expect(stale).toEqual([]);
  });

  it("the scan can see a violation (sabotage check)", () => {
    const reads = (t: string) => [...t.matchAll(FROM_AUDIT)].filter((m) => isReader(t, (m.index ?? 0) + m[0].length)).length;
    expect(reads(`const { data } = await supabase\n  .from("audit_log")\n  .select("id, event");`)).toBe(1);
    expect(reads(`const q = supabase.from("audit_log"); await q.select("id");`)).toBe(1);
    expect(reads(`await supabase.from("audit_log").insert({ a: 1 }).select("id");`)).toBe(1);
    expect(reads(`await svc.from("audit_log").insert({ action: "x" });`)).toBe(0);
  });
});

/**
 * S2 (2026-11-05): a session-client insert into audit_log must not come back. The direct INSERT policy is now self-only and
 * step 2 removes it; a signed-in caller writes through record_audit_event / record_audit_events, which stamp the actor and
 * organisation in the database. An insert is fine only when its receiver is a service-role client (named svc, service*,
 * serviceRole*, admin*, or createServiceRoleClient()).
 */
const SERVICE_RECEIVER = /(?:^|[^\w$])(?:svc|service\w*|serviceRole\w*|admin\w*|createServiceRoleClient\(\s*\))\s*$/i;

function receiverIsServiceRole(text: string, startOfFrom: number): boolean {
  const before = text.slice(Math.max(0, startOfFrom - 120), startOfFrom).replace(/\s+$/, "");
  return SERVICE_RECEIVER.test(before);
}

function findSessionInserts(text: string): number[] {
  const offsets: number[] = [];
  for (const m of text.matchAll(FROM_AUDIT)) {
    const start = m.index ?? 0;
    if (!isReader(text, start + m[0].length) && !receiverIsServiceRole(text, start)) offsets.push(start);
  }
  return offsets;
}

describe("audit_log: no direct insert from a signed-in session (S2)", () => {
  it("every direct insert uses a service-role client", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      // Edge functions build their client from the service-role key (no user session exists there), so they are out of scope.
      if (dir.startsWith("supabase/functions")) continue;
      for (const full of sourceFiles(join(REPO_ROOT, dir))) {
        const text = readFileSync(full, "utf8");
        for (const start of findSessionInserts(text)) {
          offenders.push(`${relative(REPO_ROOT, full)}:${text.slice(0, start).split("\n").length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scan can see a violation (sabotage check)", () => {
    expect(findSessionInserts(`await supabase.from("audit_log").insert({ action: "x" });`)).toHaveLength(1);
    expect(findSessionInserts(`await deps.supabase\n  .from("audit_log")\n  .insert({ action: "x" });`)).toHaveLength(1);
    expect(findSessionInserts(`await svc.from("audit_log").insert({ action: "x" });`)).toHaveLength(0);
    expect(findSessionInserts(`await createServiceRoleClient()\n    .from("audit_log")\n    .insert({ a: 1 });`)).toHaveLength(0);
    expect(findSessionInserts(`await serviceRoleSupabase.from("audit_log").insert({ a: 1 });`)).toHaveLength(0);
  });
});
