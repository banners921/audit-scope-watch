import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, FileText, Send, ChevronDown, Sparkles, Calendar, Wallet, Layers, Building2, Search, Slack } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { AsyncAutocomplete, type AutocompleteOption } from "@/components/AsyncAutocomplete";

type FilterKind = "fund_portfolio" | "companies" | "categories" | "funds";

type SavedReport = {
  id: string;
  title: string;
  filter_kind: FilterKind;
  date_from: string | null;
  date_to: string | null;
  markdown: string;
  meta: Record<string, number> | null;
  delivered_to_slack: boolean;
  created_at: string;
};

const API = (import.meta.env.VITE_SUPABASE_URL as string) || "https://qktjbtmcjrwzmtqnszbq.supabase.co";

function dateNDaysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

export default function Reports() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [kind, setKind] = useState<FilterKind>("fund_portfolio");
  const [companySlugs, setCompanySlugs] = useState<string[]>([]);
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({});
  const [fundSlugs, setFundSlugs] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>(dateNDaysAgo(14));
  const [dateTo, setDateTo] = useState<string>(dateNDaysAgo(0));
  const [title, setTitle] = useState<string>("");
  const [includeNews, setIncludeNews] = useState(true);
  const [pushToSlack, setPushToSlack] = useState(false);
  const [openReportId, setOpenReportId] = useState<string | null>(null);

  // Search fetchers (reused pattern)
  const searchCompanies = async (q: string): Promise<AutocompleteOption[]> => {
    if (q.length < 2) return [];
    const { data } = await supabase.from("companies").select("slug,name").ilike("name", `%${q}%`).limit(20);
    const rows = (data || []) as Array<{ slug: string; name: string }>;
    return rows.map((r) => ({ value: r.slug, label: r.name }));
  };
  const searchFunds = async (q: string): Promise<AutocompleteOption[]> => {
    if (q.length < 2) return [];
    const { data } = await supabase.from("funds").select("slug,name,investment_count").ilike("name", `%${q}%`).order("investment_count", { ascending: false, nullsFirst: false }).limit(20);
    const rows = (data || []) as Array<{ slug: string; name: string; investment_count: number | null }>;
    return rows.map((r) => ({ value: r.slug, label: r.name + (r.investment_count ? ` · ${r.investment_count} deals` : "") }));
  };

  // List of distinct categories — populated from the Companies table
  const catQ = useQuery({
    queryKey: ["reports-categories"],
    queryFn: async (): Promise<string[]> => {
      const { data } = await supabase.from("companies").select("category").not("category", "is", null).limit(2000);
      const set = new Set<string>();
      for (const r of (data || []) as Array<{ category: string }>) if (r.category) set.add(r.category);
      return Array.from(set).sort();
    },
  });

  // List of recent reports
  const reportsQ = useQuery({
    queryKey: ["reports-list", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<SavedReport[]> => {
      const { data } = await supabase
        .from("reports")
        .select("id,title,filter_kind,date_from,date_to,markdown,meta,delivered_to_slack,created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data as SavedReport[]) ?? [];
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sign in required");
      const body: Record<string, unknown> = {
        kind,
        date_from: dateFrom,
        date_to: dateTo,
        title: title.trim() || undefined,
        include_news: includeNews,
        push_to_slack: pushToSlack,
      };
      if (kind === "companies") body.company_slugs = companySlugs;
      if (kind === "funds") body.fund_slugs = fundSlugs;
      if (kind === "categories") body.categories = categories;

      const r = await fetch(`${API}/functions/v1/generate-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      return j as { ok: true; report_id: string; markdown: string; meta: Record<string, number> };
    },
    onSuccess: (j) => {
      toast.success(j.meta.slack_delivered ? "Report generated + delivered to Slack" : "Report generated");
      qc.invalidateQueries({ queryKey: ["reports-list"] });
      setOpenReportId(j.report_id);
    },
    onError: (e) => toast.error(`Generate failed: ${(e as Error).message}`),
  });

  const open = (reportsQ.data || []).find((r) => r.id === openReportId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5 max-w-[1500px]">
      {/* LEFT: filters + new report */}
      <div className="space-y-4">
        <div className="as-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-white">New report</h3>
          </div>

          {/* Scope picker */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Scope</label>
            <div className="grid grid-cols-2 gap-2">
              <ScopeBtn icon={<Wallet className="w-3.5 h-3.5" />} label="My fund" active={kind === "fund_portfolio"} onClick={() => setKind("fund_portfolio")} />
              <ScopeBtn icon={<Building2 className="w-3.5 h-3.5" />} label="Companies" active={kind === "companies"} onClick={() => setKind("companies")} />
              <ScopeBtn icon={<Layers className="w-3.5 h-3.5" />} label="Categories" active={kind === "categories"} onClick={() => setKind("categories")} />
              <ScopeBtn icon={<Search className="w-3.5 h-3.5" />} label="Funds" active={kind === "funds"} onClick={() => setKind("funds")} />
            </div>
          </div>

          {/* Scope-specific input */}
          {kind === "companies" && (
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Companies</label>
              <AsyncAutocomplete
                values={companySlugs}
                onChange={setCompanySlugs}
                placeholder="Search companies…"
                fetcher={searchCompanies}
                renderChipLabel={(slug) => companyNames[slug] || slug}
              />
            </div>
          )}
          {kind === "funds" && (
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Funds</label>
              <AsyncAutocomplete
                values={fundSlugs}
                onChange={setFundSlugs}
                placeholder="Search funds…"
                fetcher={searchFunds}
              />
            </div>
          )}
          {kind === "categories" && (
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Categories</label>
              <CategoryMultiSelect options={catQ.data || []} values={categories} onChange={setCategories} />
            </div>
          )}
          {kind === "fund_portfolio" && (
            <div className="text-[11px] text-muted-foreground italic">
              Uses the fund you set in Profile. Switch to "Funds" to report on different funds.
            </div>
          )}

          {/* Date range */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="as-input w-full" />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="as-input w-full" />
            </div>
          </div>
          <div className="flex gap-2 text-[11px]">
            {[7, 14, 30, 90].map((n) => (
              <button key={n} type="button" onClick={() => { setDateFrom(dateNDaysAgo(n)); setDateTo(dateNDaysAgo(0)); }}
                className="px-2 py-1 rounded bg-white/[0.03] text-muted-foreground hover:text-white hover:bg-white/[0.06]">
                last {n}d
              </button>
            ))}
          </div>

          {/* Title (optional) */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Title (optional)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Auto-generated if blank" className="as-input w-full" />
          </div>

          {/* Toggles */}
          <div className="space-y-2 text-xs">
            <Toggle label="Include news (live web search)" checked={includeNews} onChange={setIncludeNews} />
            <Toggle label={<span className="inline-flex items-center gap-1"><Slack className="w-3 h-3" /> Push to Slack</span>} checked={pushToSlack} onChange={setPushToSlack} />
          </div>

          {/* Generate */}
          <button
            type="button"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="as-btn as-btn-primary w-full disabled:opacity-50"
          >
            {generate.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
            ) : (
              <><Sparkles className="w-4 h-4" /> Generate report</>
            )}
          </button>
        </div>

        {/* History */}
        <div className="as-card p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06]">
            <h3 className="text-sm font-semibold text-white">History</h3>
          </div>
          {(reportsQ.data ?? []).length === 0 ? (
            <div className="px-5 py-6 text-xs text-muted-foreground italic text-center">No reports yet.</div>
          ) : (
            <div className="divide-y divide-white/[0.04] max-h-[600px] overflow-y-auto">
              {(reportsQ.data || []).map((r) => (
                <button
                  key={r.id}
                  onClick={() => setOpenReportId(r.id)}
                  className={`w-full px-5 py-3 text-left hover:bg-white/[0.02] ${openReportId === r.id ? "bg-primary/[0.04]" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white truncate flex-1">{r.title}</span>
                    {r.delivered_to_slack && <Slack className="w-3 h-3 text-emerald-400 shrink-0" />}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                    <Calendar className="w-3 h-3" />
                    <span>{r.date_from} → {r.date_to}</span>
                    <span>·</span>
                    <span>{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: report viewer */}
      <div className="as-card p-6 min-h-[400px]">
        {!open ? (
          <div className="text-center text-sm text-muted-foreground py-16">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
            Generate a report or pick one from history.
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/[0.06]">
              <div>
                <h2 className="text-base font-semibold text-white">{open.title}</h2>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {open.date_from} → {open.date_to} · generated {new Date(open.created_at).toLocaleString()}
                  {open.meta && (
                    <> · {Object.entries(open.meta).filter(([_, v]) => typeof v === "number" && v > 0).map(([k, v]) => `${v} ${k}`).join(" · ")}</>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(open.markdown); toast.success("Copied markdown"); }}
                className="text-xs text-muted-foreground hover:text-white inline-flex items-center gap-1"
              >
                <FileText className="w-3 h-3" /> Copy
              </button>
            </div>
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{open.markdown}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScopeBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-white/[0.06] text-muted-foreground hover:text-white hover:bg-white/[0.03]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
             className="accent-primary w-3.5 h-3.5" />
      <span className="text-white/90">{label}</span>
    </label>
  );
}

function CategoryMultiSelect({ options, values, onChange }: { options: string[]; values: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="as-input w-full text-left flex items-center justify-between"
      >
        <span className="truncate">
          {values.length === 0 ? <span className="text-muted-foreground">Pick categories…</span> : `${values.length} selected`}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {values.map((v) => (
            <span key={v} className="text-[11px] px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
              {v}
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-white/[0.06] bg-surface shadow-xl">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(values.includes(opt) ? values.filter((v) => v !== opt) : [...values, opt])}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/[0.04] ${
                values.includes(opt) ? "text-primary" : "text-white/85"
              }`}
            >
              {values.includes(opt) ? "✓ " : "  "}{opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
