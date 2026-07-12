import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex w-full rounded-md border border-charcoal-ink/20 bg-white px-3 py-2 text-sm placeholder:text-charcoal-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
