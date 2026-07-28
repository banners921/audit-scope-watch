import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, ChevronDown, ExternalLink, Target } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { CompanyLogo } from "@/components/CompanyLogo";
import { useAuth } from "@/hooks/useAuth";

export type FundingRoundRow = {
  id: string;
  company_slug: string | null;
  company_name: string | null;
  round_type: string | null;
  amount_usd: number | null;
  date: string | null;
  lead_investors: string | null;
  other_investors: string | null;
  all_investors: string | null;
  announcement_url: string | null;
  category: string | null;
};

export type ViewMode = "list" | "grid";

const ROUND_COLORS: Record<string, string> = {
  seed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  pre_seed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "pre-seed": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  series_a: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "series a": "bg-sky-500/15 text-sky-300 border-sky-500/30",
  series_b: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  "series b": "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  series_c: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "series c": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  strategic: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  grant: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ico: "bg-pink-500/15 text-pink-300 border-pink-500/30",
};

export function roundPillColor(t: string | null | undefined): string {
  const k = (t || "").toLowerCase().trim();
  return ROUND_COLORS[k] || "bg-white/5 text-white border-white/10";
}

export function fmtAmount(n: number | null | undefined): string {
  if (n == null || Number(n) === 0) return "Undisclosed";
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function fmtAmountShort(n: number | null | undefined): string {
  if (n == null || Number(n) === 0) return "TBA";
  const v = Number(n);
  if (v >= 1e9) {
    const x = v / 1e9;
    return `$${x % 1 === 0 ? x.toFixed(0) : x.toFixed(1)} B`;
  }
  if (v >= 1e6) {
    const x = v / 1e6;
    return `$${x % 1 === 0 ? x.toFixed(0) : x.toFixed(1)} M`;
  }
  if (v >= 1e3) {
    const x = v / 1e3;
    return `$${x % 1 === 0 ? x.toFixed(0) : x.toFixed(0)} K`;
  }
  return `$${v.toFixed(0)}`;
}

const CATEGORY_PILL: Record<string, string> = {
  defi: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  dex: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  cefi: "bg-pink-500/10 text-pink-300 border-pink-500/30",
  trading: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  payments: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  ai: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  "real world assets": "bg-orange-500/10 text-orange-300 border-orange-500/30",
  rwa: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  infrastructure: "bg-white/[0.04] text-muted-foreground border-white/15",
  gaming: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30",
  bridge: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  l1: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  l2: "bg-sky-500/10 text-sky-300 border-sky-500/30",
};

export function categoryPillColor(cat: string | null | undefined): string {
  const k = (cat || "").toLowerCase().trim();
  return CATEGORY_PILL[k] || "bg-white/[0.04] text-muted-foreground border-white/15";
}

function fmtMonthYear(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return format(dt, "MMM yyyy");
}

function fmtFullDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return format(dt, "MMM d, yyyy");
}

function parseInvestors(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function useCompanyLite(slug: string | null) {
  return useQuery({
    queryKey: ["company-lite", slug],
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("slug,name,logo,category,url")
        .eq("slug", slug!)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return (data as { slug: string; name: string; logo: string | null; category: string | null; url: string | null }) || null;
    },
  });
}

function RoundDetails({ r }: { r: FundingRoundRow }) {
  const company = useCompanyLite(r.company_slug);
  const leadArr = parseInvestors(r.lead_investors);
  const otherArr = parseInvestors(r.other_investors || r.all_investors).filter((n) => !leadArr.includes(n));

  return (
    <div className="space-y-3 px-3 py-3 bg-white/[0.02] border-t border-white/[0.04]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</div>
          <div className="font-mono text-white mt-0.5">{fmtFullDate(r.date)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Round</div>
          <div className="mt-0.5">
            <span className={`text-[11px] px-1.5 py-0.5 rounded border ${roundPillColor(r.round_type)}`}>
              {r.round_type || "—"}
            </span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount</div>
          <div className="font-mono text-teal-400 mt-0.5">{fmtAmount(r.amount_usd)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Category</div>
          <div className="text-white mt-0.5">{r.category || "—"}</div>
        </div>
      </div>

      {leadArr.length > 0 && (
        <div className="text-xs">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Led by</div>
          <div className="flex flex-wrap gap-1">
            {leadArr.map((n) => (
              <span key={n} className="text-[11px] px-1.5 py-0.5 rounded bg-teal-400/10 text-teal-400 border border-teal-400/30">
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {otherArr.length > 0 && (
        <div className="text-xs">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Other investors</div>
          <div className="flex flex-wrap gap-1">
            {otherArr.map((n) => (
              <span key={n} className="text-[11px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/80 border border-white/10">
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {r.announcement_url && (
          <a
            href={r.announcement_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-white/10 bg-white/[0.04] text-muted-foreground hover:text-primary hover:border-white/20"
          >
            <ExternalLink className="w-3 h-3" /> Announcement
          </a>
        )}
        {company.data && (
          <Link
            to={`/companies/${company.data.slug}`}
            className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.06]"
          >
            <CompanyLogo logo={company.data.logo} url={company.data.url} name={company.data.name} className="w-4 h-4 rounded" />
            View {company.data.name}
            <ExternalLink className="w-3 h-3 opacity-60" />
          </Link>
        )}
      </div>
    </div>
  );
}

export function RoundListRow({ r }: { r: FundingRoundRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded overflow-hidden ${open ? "border-l-2 border-teal-400" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-3 bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-left"
      >
        <span className="font-mono text-xs text-muted-foreground whitespace-nowrap w-20 shrink-0">
          {fmtMonthYear(r.date)}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${roundPillColor(r.round_type)}`}>
          {r.round_type || "—"}
        </span>
        <span className="text-sm text-white truncate flex-1">{r.company_name || r.company_slug}</span>
        <span className="font-mono text-base font-semibold text-teal-400 whitespace-nowrap">{fmtAmount(r.amount_usd)}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <RoundDetails r={r} />}
    </div>
  );
}

function fmtFriendlyDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return format(dt, "MMM d, yyyy");
}

function useSavedStatus(companySlug: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["saved-target-slugs", user?.id],
    enabled: !!user && !!companySlug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_targets")
        .select("company_slug")
        .eq("user_id", user!.id);
      if (error) throw error;
      return new Set((data || []).map((r: { company_slug: string }) => r.company_slug));
    },
  });
}

function TargetSaveIcon({
  companySlug,
  companyName,
  companyLogo,
}: {
  companySlug: string | null;
  companyName: string | null;
  companyLogo: string | null;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const saved = useSavedStatus(companySlug);
  const isSaved = !!companySlug && (saved.data?.has(companySlug) ?? false);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!user || !companySlug) {
      toast.error(user ? "No company linked to this round." : "Sign in to save targets.");
      return;
    }
    try {
      if (isSaved) {
        const { error } = await supabase
          .from("saved_targets")
          .delete()
          .eq("user_id", user.id)
          .eq("company_slug", companySlug);
        if (error) throw error;
        toast.success(`Removed ${companyName || companySlug}`);
      } else {
        const { error } = await supabase.from("saved_targets").insert({
          user_id: user.id,
          company_slug: companySlug,
          company_name: companyName,
          company_logo: companyLogo,
        });
        if (error) throw error;
        toast.success(`Saved ${companyName || companySlug}`);
      }
      qc.invalidateQueries({ queryKey: ["saved-target-slugs"] });
      qc.invalidateQueries({ queryKey: ["saved-targets"] });
      qc.invalidateQueries({ queryKey: ["dashboard-saved"] });
    } catch (err) {
      const o = err as { message?: string; code?: string };
      toast.error(`Save failed: ${o?.message || JSON.stringify(err)}`);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!companySlug}
      title={isSaved ? "Remove from targets" : "Save as target"}
      className={`p-1 rounded-md transition-colors ${
        isSaved
          ? "text-primary hover:bg-primary/10"
          : "text-muted-foreground hover:text-primary hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed"
      }`}
      aria-label="Save as target"
    >
      <Target className="w-3.5 h-3.5" />
    </button>
  );
}

export function RoundGridCard({ r }: { r: FundingRoundRow }) {
  const [open, setOpen] = useState(false);
  const company = useCompanyLite(r.company_slug);
  const displayName = company.data?.name || r.company_name || r.company_slug || "—";
  const category = company.data?.category || r.category;
  const logo = company.data?.logo || null;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0F1420] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-start gap-3">
          <CompanyLogo
            logo={logo}
            url={null}
            name={displayName}
            className="w-10 h-10 rounded-lg shrink-0"
          />
          <div className="min-w-0 flex-1 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{displayName}</div>
              <div className="flex items-center gap-1.5 mt-1.5">
                {category && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-md border ${categoryPillColor(category)}`}>
                    {category}
                  </span>
                )}
                <TargetSaveIcon
                  companySlug={r.company_slug}
                  companyName={r.company_name}
                  companyLogo={logo}
                />
              </div>
            </div>
            <div className="font-mono text-xl font-bold text-cyan-300 whitespace-nowrap shrink-0">
              {fmtAmountShort(r.amount_usd)}
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <Calendar className="w-3 h-3" />
            {fmtFriendlyDate(r.date)}
          </span>
          <span className={`text-[10px] px-2.5 py-1 rounded-full border ${roundPillColor(r.round_type)}`}>
            {r.round_type ? r.round_type.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "—"}
          </span>
        </div>
      </button>
      {open && <RoundDetails r={r} />}
    </div>
  );
}
