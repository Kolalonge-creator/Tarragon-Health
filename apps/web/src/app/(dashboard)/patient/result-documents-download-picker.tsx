"use client";

import { useState } from "react";

export interface DownloadableResult {
  id: string;
  label: string;
}

/**
 * Lets a patient pick which interpreted results to combine into one PDF —
 * the alternative to each result's own "Download as PDF" link (already on
 * every row in result-documents.tsx), which stays for downloading one test
 * on its own or several as separate files. Only shown when there are 2+
 * interpreted results to choose from; picking fewer than 2 has nothing to
 * combine, so the button stays disabled until then.
 */
export function ResultDocumentsDownloadPicker({ results }: { results: DownloadableResult[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const href = `/api/patient/lab-result/combined/pdf?ids=${Array.from(selected).join(",")}`;

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 bg-charcoal-ink/[0.02] dark:bg-night-ink/10 p-3">
      <p className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
        Combine results into one PDF (or use each result&rsquo;s own &ldquo;Download as PDF&rdquo; link
        above to keep them separate)
      </p>
      <ul className="space-y-1">
        {results.map((result) => (
          <li key={result.id}>
            <label className="flex items-center gap-2 text-sm text-charcoal-ink dark:text-night-ink">
              <input
                type="checkbox"
                checked={selected.has(result.id)}
                onChange={() => toggle(result.id)}
              />
              {result.label}
            </label>
          </li>
        ))}
      </ul>
      {selected.size >= 2 ? (
        <a
          href={href}
          className="inline-block text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
        >
          Download {selected.size} selected as one PDF →
        </a>
      ) : (
        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">Select at least 2 results to combine.</p>
      )}
    </div>
  );
}
