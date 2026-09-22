import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        // aria-invalid is set by fieldErrorProps whenever a server action
        // names this field as the one that failed — without a visual hook on
        // it, that signal reached only screen readers (a single error
        // message near the submit button was the only sighted-user cue,
        // wherever the field sat in a longer form). These two utilities are
        // the visual half of the same signal, not a new one.
        "flex h-10 w-full rounded-md border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink placeholder:text-charcoal-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-400 aria-invalid:focus-visible:ring-red-500 dark:border-night-ink/25 dark:bg-night-card dark:text-night-ink dark:placeholder:text-night-ink/50 dark:aria-invalid:border-red-400/70",
        className
      )}
      {...props}
    />
  );
}
