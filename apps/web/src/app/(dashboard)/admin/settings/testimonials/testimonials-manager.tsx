"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function TestimonialsManager() {
  const queryClient = useQueryClient();
  const { data: rows, isLoading } = useQuery({
    queryKey: ["admin-testimonials"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_testimonials")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "published" | "declined" | "submitted" }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("patient_testimonials")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-testimonials"] }),
  });

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (!rows || rows.length === 0)
    return <p className="text-sm text-charcoal-ink/60">No testimonials submitted yet.</p>;

  return (
    <div className="space-y-3">
      {rows.map((t) => (
        <Card key={t.id}>
          <CardContent className="space-y-2 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  t.status === "published" ? "green" : t.status === "declined" ? "grey" : "amber"
                }
              >
                {t.status}
              </Badge>
              <span className="text-sm font-medium text-charcoal-ink">{t.display_name}</span>
              <span className="text-xs text-charcoal-ink/60">
                {new Date(t.created_at).toLocaleDateString()}
              </span>
            </div>
            <p className="text-sm italic text-charcoal-ink/80">&ldquo;{t.quote}&rdquo;</p>
            <div className="flex gap-2">
              {t.status !== "published" && (
                <Button
                  size="sm"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: t.id, status: "published" })}
                >
                  Publish
                </Button>
              )}
              {t.status !== "declined" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: t.id, status: "declined" })}
                >
                  {t.status === "published" ? "Unpublish" : "Decline"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
