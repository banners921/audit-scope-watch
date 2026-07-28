import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Star, X, Bell, BellOff, ExternalLink, Banknote, ShieldCheck, Newspaper, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { EntityCard } from "@/components/EntityCard";

type WatchRow = {
  company_slug: string;
  alert_on_audit: boolean;
  alert_on_funding: boolean;
  alert_on_news: boolean;
  alert_on_hack: boolean;
  created_at: string;
  company?: {
    name: string;
    logo: string | null;
    category: string | null;
    url: string | null;
    description: string | null;
  };
};

export default function Watchlist() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const slackQ = useQuery({
    queryKey: ["slack-webhook-url", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("user_profiles").select("slack_webhook_url").eq("user_id", user!.id).maybeSingle();
      return (data?.slack_webhook_url as string | null) ?? null;
    },
  });

  const watchQ = useQuery<WatchRow[]>({
    queryKey: ["watchlist", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("target_actions")
        .select("company_slug,alert_on_audit,alert_on_funding,alert_on_news,alert_on_hack,created_at")
        .eq("user_id", user!.id)
        .eq("action", "watched")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as WatchRow[];
      if (rows.length === 0) return rows;
      const slugs = rows.map((r) => r.company_slug);
      const { data: companies } = await supabase
        .from("companies")
        .select("slug,name,logo,category,url,description")
        .in("slug", slugs);
      const byslug = new Map<string, any>();
      for (const c of (companies ?? []) as any[]) byslug.set(c.slug, c);
      return rows.map((r) => ({ ...r, company: byslug.get(r.company_slug) }));
    },
  });

  const toggleMut = useMutation({
    mutationFn: async ({ slug, field, value }: { slug: string; field: keyof WatchRow; value: boolean }) => {
      const { error } = await supabase
        .from("target_actions")
        .update({ [field]: value })
        .eq("user_id", user!.id)
        .eq("company_slug", slug);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist", user?.id] }),
  });

  const removeMut = useMutation({
    mutationFn: async (slug: string) => {
      const { error } = await supabase
        .from("target_actions")
        .delete()
        .eq("user_id", user!.id)
        .eq("company_slug", slug);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist", user?.id] });
      qc.invalidateQueries({ queryKey: ["watchlist-count", user?.id] });
      qc.invalidateQueries({ queryKey: ["next-target"] });
      toast.success("Removed from watchlist");
    },
  });

  return (
    <div className="max-w-[1100px] mx-auto space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Watchlist</div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">{watchQ.data?.length ?? 0} watched</h1>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {slackQ.data ? (
            <span className="inline-flex items-center gap-1.5"><Bell className="w-3 h-3 text-emerald-400" /> Slack alerts active</span>
          ) : (
            <Link to="/profile" className="inline-flex items-center gap-1.5 text-amber-300 hover:underline">
              <BellOff className="w-3 h-3" /> Slack not connected — set up in Profile
            </Link>
          )}
        </div>
      </header>

      {watchQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}

      {watchQ.data && watchQ.data.length === 0 && (
        <div className="as-card p-8 text-center space-y-2">
          <Star className="w-6 h-6 text-primary mx-auto" />
          <div className="text-sm text-foreground">No companies watched yet.</div>
          <div className="text-[12px] text-muted-foreground">
            Hit <span className="font-semibold text-emerald-300">Watch</span> on the <Link to="/dashboard" className="text-primary hover:underline">Dashboard</Link> target stream to add companies here.
          </div>
        </div>
      )}

      {watchQ.data && watchQ.data.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {watchQ.data.map((row) => (
            <div key={row.company_slug} className="as-card p-4 space-y-3 group">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-white/[0.04] flex items-center justify-center">
                  {row.company?.logo ? (
                    <img src={row.company.logo} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <span className="text-[12px] font-bold opacity-60">{(row.company?.name ?? row.company_slug)[0]?.toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={`/protocol/${row.company_slug}`} className="text-[14px] font-semibold text-foreground hover:text-primary truncate block">
                    {row.company?.name || row.company_slug}
                  </Link>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 truncate">
                    {row.company?.category && <span>{row.company.category}</span>}
                    {row.company?.url && (
                      <a href={safeUrl(row.company.url)} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1 truncate">
                        {row.company.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeMut.mutate(row.company_slug)}
                  className="text-muted-foreground/60 hover:text-rose-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove from watchlist"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {row.company?.description && (
                <div className="text-[11.5px] text-muted-foreground leading-relaxed line-clamp-2">{row.company.description}</div>
              )}

              {/* Alert toggles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
                <AlertToggle
                  icon={<ShieldCheck className="w-3 h-3" />}
                  label="Audit"
                  active={row.alert_on_audit}
                  onClick={() => toggleMut.mutate({ slug: row.company_slug, field: "alert_on_audit", value: !row.alert_on_audit })}
                />
                <AlertToggle
                  icon={<Banknote className="w-3 h-3" />}
                  label="Funding"
                  active={row.alert_on_funding}
                  onClick={() => toggleMut.mutate({ slug: row.company_slug, field: "alert_on_funding", value: !row.alert_on_funding })}
                />
                <AlertToggle
                  icon={<Newspaper className="w-3 h-3" />}
                  label="News"
                  active={row.alert_on_news}
                  onClick={() => toggleMut.mutate({ slug: row.company_slug, field: "alert_on_news", value: !row.alert_on_news })}
                />
                <AlertToggle
                  icon={<TrendingUp className="w-3 h-3" />}
                  label="Hack"
                  active={row.alert_on_hack}
                  onClick={() => toggleMut.mutate({ slug: row.company_slug, field: "alert_on_hack", value: !row.alert_on_hack })}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AlertToggle({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[10.5px] font-semibold transition-colors ${
        active
          ? "border-primary/40 bg-primary/[0.08] text-primary"
          : "border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
      }`}
      title={`Toggle ${label} alerts`}
    >
      {icon} {label}
    </button>
  );
}

function safeUrl(u: string) {
  return u.startsWith("http") ? u : `https://${u}`;
}
