"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A file chooser that looks like the rest of the app. The browser's own `<input type="file">` renders as a grey "Choose File /
 * No file chosen" control that no amount of class names restyles the same way on iOS, Android and desktop, and it was the
 * first thing on the Profile, Labs and Medicines pages (design audit, 2026-10-29). The real input stays in the form (so a plain
 * form post and `required` keep working), visually hidden; the button and the chosen file's name are what the person sees.
 */
export function FilePicker({
  id,
  name,
  accept,
  capture,
  required,
  label,
  hint,
  onFile,
  inputRef,
  fileName,
  className,
  variant = "outline",
  ...rest
}: Omit<React.ComponentProps<"input">, "type" | "onChange" | "capture"> & {
  id: string;
  /** The button text: "Choose a photo", "Choose a file". */
  label: string;
  /** One line under the button: what is accepted and how big. */
  hint?: string;
  capture?: "user" | "environment";
  /** Called with the chosen file (or null when the choice is cleared). */
  onFile?: (file: File | null) => void;
  /** The real input, for a form that clears the choice after a save. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** A form that already tracks the chosen file passes its name (null once cleared), so the two never disagree. */
  fileName?: string | null;
  variant?: "default" | "outline";
}) {
  const own = React.useRef<HTMLInputElement | null>(null);
  const input = inputRef ?? own;
  const [ownChosen, setChosen] = React.useState<string | null>(null);
  const chosen = fileName !== undefined ? fileName : ownChosen;
  return (
    <div className={cn("space-y-1.5", className)}>
      <input
        ref={input}
        id={id}
        name={name}
        type="file"
        accept={accept}
        capture={capture}
        required={required}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setChosen(f ? f.name : null);
          onFile?.(f);
        }}
        {...rest}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant={variant} className="min-h-11" onClick={() => input.current?.click()}>
          {label}
        </Button>
        <span className="text-sm text-charcoal-ink/70 dark:text-night-ink/70" aria-live="polite">
          {chosen ?? "No file chosen yet"}
        </span>
      </div>
      {hint && <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{hint}</p>}
    </div>
  );
}
