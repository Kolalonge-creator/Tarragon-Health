import * as React from "react";
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        // See input.tsx's aria-invalid comment — same visual hook, same reason.
        "flex h-10 w-full rounded-md border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-400 aria-invalid:focus-visible:ring-red-500 dark:border-night-ink/25 dark:bg-night-card dark:text-night-ink dark:aria-invalid:border-red-400/70",
        className
      )}
      {...props}
    />
  );
}
