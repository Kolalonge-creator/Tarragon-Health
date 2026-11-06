/**
 * Header patient search for clinical staff (doctor workspace spec 6 and 25, gap G6). A plain GET form to the
 * patient directory: no live suggestions, so nothing about a patient appears until the search is submitted, and the
 * results page applies the same RLS and test-account rules as the directory itself. Works without JavaScript.
 */
export function PatientSearchBox({
  action = "/clinician/patients",
}: {
  action?: string;
}) {
  return (
    <>
      {/* Phones: the header has no room for a field, so a link to the directory, whose own box does the same search. */}
      <a
        href={action}
        className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-charcoal-ink underline md:hidden"
      >
        Find a patient
      </a>
      <form
        method="get"
        action={action}
        role="search"
        aria-label="Find a patient"
        className="hidden md:block"
      >
        <label htmlFor="header-patient-search" className="sr-only">
          Find a patient by name, Tarragon number or phone
        </label>
        <input
          id="header-patient-search"
          type="search"
          name="q"
          placeholder="Find a patient"
          autoComplete="off"
          maxLength={100}
          className="h-9 w-56 rounded-lg border border-charcoal-ink/15 bg-white px-3 text-sm text-charcoal-ink placeholder:text-charcoal-ink/50 focus:border-brand-green focus:outline-none lg:w-72"
        />
      </form>
    </>
  );
}
