import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

// Single saved-targets query shared across pages. Each consumer reads from the same cache.
function useSavedSlugSet() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["saved-targets-set", user?.id],
    enabled: !!user,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_targets")
        .select("company_slug,target_kind")
        .eq("user_id", user!.id);
      const s = new Set<string>();
      for (const r of (data ?? []) as any[]) s.add(`${r.target_kind || "company"}::${r.company_slug}`);
      return s;
    },
  });
}

type Props = {
  slug: string;
  name?: string;
  logo?: string | null;
  kind?: "company" | "firm" | "fund";
  size?: "sm" | "md";
  className?: string;
};

export function SaveTargetButton({ slug, name, logo, kind = "company", size = "sm", className = "" }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const savedQ = useSavedSlugSet();
  const key = `${kind}::${slug}`;
  const isSaved = savedQ.data?.has(key) ?? false;

  const toggle = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!user) return;
    if (isSaved) {
      await supabase.from("saved_targets").delete().eq("user_id", user.id).eq("company_slug", slug).eq("target_kind", kind);
    } else {
      await supabase.from("saved_targets").insert({
        user_id: user.id,
        company_slug: slug,
        company_name: name || slug,
        company_logo: logo || null,
        target_kind: kind,
        pipeline_stage: "follow",
        saved_at: new Date().toISOString(),
      });
    }
    qc.invalidateQueries({ queryKey: ["saved-targets-set", user.id] });
    qc.invalidateQueries({ queryKey: ["teams-saved", user.id] });
  };

  const iconSize = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";
  const padding = size === "md" ? "p-1.5" : "p-1";
  return (
    <button
      type="button"
      onClick={toggle}
      className={`${padding} rounded transition-colors ${isSaved ? "text-primary bg-primary/15 hover:bg-primary/25 ring-1 ring-primary/40" : "text-muted-foreground hover:text-primary hover:bg-white/[0.04]"} ${className}`}
      title={isSaved ? "Remove from targets" : "Save as target"}
    >
      <Crosshair className={iconSize} />
    </button>
  );
}
