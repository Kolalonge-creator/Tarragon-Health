"use client";

import { useActionState } from "react";
import { moderateTestimonial } from "./actions";
import { Button } from "@/components/ui/button";

export function TestimonialModerationButtons({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(moderateTestimonial, undefined);

  return (
    <div className="flex items-center gap-2 pt-1">
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="published" />
        <Button type="submit" size="sm" disabled={pending}>
          Publish
        </Button>
      </form>
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="declined" />
        <Button type="submit" size="sm" variant="ghost" disabled={pending}>
          Decline
        </Button>
      </form>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
