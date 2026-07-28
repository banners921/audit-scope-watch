import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Target, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { CompanyLogo } from "@/components/CompanyLogo";
import { useAuth } from "@/hooks/useAuth";

type SavedRow = {
  id: string;
  company_slug: string;
  company_name: string | null;
  company_logo: string | null;
  saved_at: string;
};

export default function SavedTargetsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const saved = useQuery({
    queryKey: ["saved-targets", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_targets")
        .select("id,company_slug,company_name,company_logo,saved_at")
        .eq("user_id", user!.id)
        .order("saved_at", { ascending: false });
      if (error) throw error;
      return (data || []) as SavedRow[];
    },
  });

  async function remove(slug: string, name: string | null) {
    if (!user) return;
    try {
      const { error } = await supabase
        .from("saved_targets")
        .delete()
        .eq("user_id", user.id)
        .eq("company_slug", slug);
      if (error) throw error;
      toast.success(`Removed ${name || slug}`);
      qc.invalidateQueries({ queryKey: ["saved-targets"] });
      qc.invalidateQueries({ queryKey: ["saved-target-slugs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-saved"] });
    } catch (e) {
      console.error("[saved_targets remove]", e);
      const o = e as { message?: string; code?: string; details?: string } | null;
      const msg =
        e instanceof Error
          ? e.message
          : o?.message
            ? `${o.message}${o.code ? ` (${o.code})` : ""}`
            : JSON.stringify(e);
      toast.error(`Remove failed: ${msg}`);
    }
  }

  const rows = saved.data || [];

  return (
    <div className="space-y-4 max-w-[1200px]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Saved Targets</h2>
          <p className="text-sm text-muted-foreground">Accounts you've bookmarked for follow-up.</p>
        </div>
        <span className="text-xs font-mono text-muted-foreground">{rows.length} saved</span>
      </div>

      {saved.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-white/[0.03] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="as-card p-10 text-center">
          <Target className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <div className="text-sm text-muted-foreground">
            No saved targets yet. Click the bullseye on any company to add it here.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((r) => (
            <div
              key={r.id}
              className="as-card p-4 flex items-start gap-3 hover:border-white/20 transition-colors group"
            >
              <CompanyLogo
                logo={r.company_logo}
                url={null}
                name={r.company_name || r.company_slug}
                className="w-10 h-10 rounded-md shrink-0"
              />
              <Link to={`/companies/${r.company_slug}`} className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white truncate">
                  {r.company_name || r.company_slug}
                </div>
                <div className="text-[11px] font-mono text-muted-foreground mt-1">
                  Saved {formatDistanceToNow(new Date(r.saved_at), { addSuffix: true })}
                </div>
              </Link>
              <button
                type="button"
                onClick={() => remove(r.company_slug, r.company_name)}
                aria-label={`Remove ${r.company_name || r.company_slug}`}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-1 rounded"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
