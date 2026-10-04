import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowUpDown, ArrowDown, ArrowUp, Wallet, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

// Funds backing fundraises by companies with category = 'Security'.
// Aggregated server-side by security_investor_stats(); the drill-down reads the
// underlying rows from the security_round_investors view (deduped, M&A excluded).

type Range = "all" | "12m" | "3m";
const RANGES: { key: Range; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "12m", label: "Last 12 months" },
  { key: "3m", label: "Last 3 months" },
];

function sinceFor(r: Range): string | null {
  if (r === "all") return null;
  const d = new Date();
  d.setMonth(d.getMonth() - (r === "12m" ? 12 : 3));
  return d.toISOString().slice(0, 10);
}

type Row = {
  investor_key: string;
  investor_name: string;
  fund_slug: string | null;
  fund_logo: string | null;
  investments: number;
  rounds_with_lead_data: number;
  rounds_led: number;
  disclosed_rounds: number;
  undisclosed_rounds: number;
  total_round_usd: number | null;
  avg_round_usd: number | null;
  round_types: Record<string, number>;
  latest_company: string | null;
  latest_company_slug: string | null;
  latest_date: string | null;
};

type RoundRow = {
  round_id: string;
  company_slug: string;
  company_name: string;
  date: string;
  round_type: string | null;
  amount_usd: number | null;
  round_has_lead_data: boolean;
  is_lead: boolean;
  announcement_url: string | null;
};

type SortCol = "investor_name" | "investments" | "rounds_led" | "total_round_usd" | "avg_round_usd" | "round_types" | "latest_date";

function usd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

// Sort value per column. A fund with no lead data sorts below one with 0 leads:
// "unknown" is not "none".
function sortVal(r: Row, col: SortCol): number | string | null {
  switch (col) {
    case "investor_name": return r.investor_name.toLowerCase();
    case "rounds_led": return r.rounds_with_lead_data === 0 ? null : r.rounds_led;
    case "round_types": return Object.keys(r.round_types).length;
    default: return r[col] ?? null;
  }
}

type Drill = { row: Row; leadOnly: boolean };

export default function SecurityInvestors() {
  const [range, setRange] = useState<Range>("all");
  const [sort, setSort] = useState<{ col: SortCol; asc: boolean }>({ col: "investments", asc: false });
  const [drill, setDrill] = useState<Drill | null>(null);
  const since = sinceFor(range);

  const statsQ = useQuery({
    queryKey: ["security-investors", since],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("security_investor_stats", { p_since: since });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = useMemo(() => {
    const out = [...(statsQ.data ?? [])];
    out.sort((a, b) => {
      const va = sortVal(a, sort.col), vb = sortVal(b, sort.col);
      // nulls (undisclosed / no lead data) always last, whichever direction
      if (va == null && vb == null) return a.investor_name.localeCompare(b.investor_name);
      if (va == null) return 1;
      if (vb == null) return -1;
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return (sort.asc ? c : -c) || a.investor_name.localeCompare(b.investor_name);
    });
    return out;
  }, [statsQ.data, sort]);

  const totals = useMemo(() => {
    const r = statsQ.data ?? [];
    return { funds: r.length, links: r.reduce((s, x) => s + x.investments, 0) };
  }, [statsQ.data]);

  const roundsQ = useQuery({
    queryKey: ["security-investor-rounds", drill?.row.investor_key, drill?.leadOnly, since],
    enabled: !!drill,
    queryFn: async () => {
      let q = supabase
        .from("security_round_investors")
        .select("round_id,company_slug,company_name,date,round_type,amount_usd,round_has_lead_data,is_lead,announcement_url")
        .eq("investor_key", drill!.row.investor_key)
        .order("date", { ascending: false });
      if (since) q = q.gte("date", since);
      if (drill!.leadOnly) q = q.eq("is_lead", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as RoundRow[];
    },
  });
  const roundCountQ = useQuery({
    queryKey: ["security-round-count", since],
    queryFn: async () => {
      let q = supabase.from("security_round_investors").select("round_id");
      if (since) q = q.gte("date", since);
      const { data, error } = await q;
      if (error) throw error;
      return new Set((data ?? []).map((r: { round_id: string }) => r.round_id)).size;
    },
  });

  const head = (col: SortCol, label: string, align: "left" | "right" = "right") => {
    const active = sort.col === col;
    const Icon = !active ? ArrowUpDown : sort.asc ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => setSort((s) => ({ col, asc: s.col === col ? !s.asc : col === "investor_name" }))}
        className={`flex items-center gap-1 hover:text-foreground ${align === "right" ? "justify-end" : "text-left"} ${active ? "text-foreground" : ""}`}
      >
        {label} <Icon className="w-3 h-3" />
      </button>
    );
  };

  const cols = "grid-cols-[minmax(200px,1.6fr)_90px_120px_100px_100px_minmax(150px,1.2fr)_minmax(170px,1.2fr)]";

  return (
    <div className="max-w-[1280px] mx-auto space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">
            <Link to="/funds" className="hover:underline">Funds</Link> / Security investors
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">
            {statsQ.data ? totals.funds.toLocaleString() : "—"} investors in security fundraises
          </h1>
          <p className="mt-1 text-[12px] text-muted-foreground max-w-[720px]">
            Rounds raised by companies in the Security category
            {roundCountQ.data != null && <> ({roundCountQ.data.toLocaleString()} rounds)</>}. M&amp;A excluded.
            Dollar figures are round sizes; per-investor check sizes are not disclosed. Undisclosed amounts are left
            out of totals and averages, not counted as $0.
          </p>
        </div>
        <div className="flex rounded-md border border-white/[0.06] overflow-hidden text-[12px]">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 ${range === r.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {statsQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}
      {statsQ.error && <div className="as-card p-6 text-center text-sm text-red-400">Failed to load: {(statsQ.error as Error).message}</div>}
      {statsQ.data && rows.length === 0 && (
        <div className="as-card p-6 text-center text-sm text-muted-foreground">No security rounds in this period.</div>
      )}

      {rows.length > 0 && (
        <div className="as-card overflow-x-auto">
          <div className="min-w-[1040px]">
            <div className={`grid ${cols} gap-3 px-4 py-2 border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-muted-foreground`}>
              {head("investor_name", "Fund", "left")}
              {head("investments", "Investments")}
              {head("rounds_led", "Led")}
              {head("total_round_usd", "Total $")}
              {head("avg_round_usd", "Avg round")}
              {head("round_types", "Round types", "left")}
              {head("latest_date", "Most recent", "left")}
            </div>
            {rows.map((r) => (
              <div key={r.investor_key} className={`grid ${cols} gap-3 px-4 py-2.5 items-center border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]`}>
                <span className="flex items-center gap-2.5 min-w-0">
                  {r.fund_logo ? (
                    <img src={r.fund_logo} alt="" className="w-6 h-6 rounded object-contain bg-white/[0.04] shrink-0" />
                  ) : (
                    <span className="w-6 h-6 rounded bg-white/[0.04] grid place-items-center shrink-0">
                      <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
                    </span>
                  )}
                  {r.fund_slug ? (
                    <Link to={`/funds/${r.fund_slug}`} className="truncate text-[13px] text-foreground hover:text-primary">{r.investor_name}</Link>
                  ) : (
                    <span className="truncate text-[13px] text-foreground">
                      {r.investor_name} <span className="text-[11px] text-muted-foreground">· not in funds table</span>
                    </span>
                  )}
                </span>
                <span className="text-right">
                  <button type="button" onClick={() => setDrill({ row: r, leadOnly: false })} className="font-mono tabular-nums text-[12.5px] text-primary hover:underline">
                    {r.investments}
                  </button>
                </span>
                <span className="text-right font-mono tabular-nums text-[12px]" title={r.rounds_with_lead_data === 0 ? "None of this fund's rounds have lead-investor data" : undefined}>
                  {r.rounds_with_lead_data === 0 ? (
                    <span className="text-muted-foreground">n/a</span>
                  ) : (
                    <>
                      {r.rounds_led > 0 ? (
                        <button type="button" onClick={() => setDrill({ row: r, leadOnly: true })} className="text-primary hover:underline">{r.rounds_led}</button>
                      ) : (
                        <span>0</span>
                      )}
                      <span className="text-muted-foreground"> of {r.rounds_with_lead_data}</span>
                    </>
                  )}
                </span>
                <span className="text-right font-mono tabular-nums text-[12px]" title={r.undisclosed_rounds ? `${r.undisclosed_rounds} round(s) with undisclosed amount excluded` : undefined}>
                  {r.total_round_usd != null ? usd(r.total_round_usd) : <span className="text-muted-foreground">undisclosed</span>}
                  {r.undisclosed_rounds > 0 && r.total_round_usd != null && <span className="text-muted-foreground text-[10.5px]"> +{r.undisclosed_rounds}?</span>}
                </span>
                <span className="text-right font-mono tabular-nums text-[12px]">
                  {r.avg_round_usd != null ? usd(r.avg_round_usd) : <span className="text-muted-foreground">undisclosed</span>}
                </span>
                <span className="text-[11.5px] text-muted-foreground truncate" title={Object.entries(r.round_types).map(([k, v]) => `${k} ×${v}`).join(", ")}>
                  {Object.entries(r.round_types).map(([k, v]) => `${k} ×${v}`).join(", ")}
                </span>
                <span className="text-[12px] min-w-0 truncate">
                  {r.latest_company_slug ? (
                    <Link to={`/protocol/${r.latest_company_slug}`} className="text-foreground hover:text-primary">{r.latest_company}</Link>
                  ) : (
                    <span className="text-foreground">{r.latest_company}</span>
                  )}
                  <span className="text-muted-foreground font-mono tabular-nums"> · {r.latest_date ?? "date unknown"}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent className="w-full sm:max-w-[560px] overflow-y-auto">
          {drill && (
            <>
              <SheetHeader>
                <SheetTitle>{drill.row.investor_name}</SheetTitle>
                <SheetDescription>
                  {drill.leadOnly ? "Security rounds led" : "Security rounds participated in"} · {RANGES.find((x) => x.key === range)!.label.toLowerCase()}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-1.5">
                {roundsQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
                {(roundsQ.data ?? []).map((x) => (
                  <div key={x.round_id} className="as-card px-3 py-2.5 text-[12.5px] flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/protocol/${x.company_slug}`} className="text-foreground hover:text-primary font-medium">{x.company_name}</Link>
                      <div className="text-muted-foreground text-[11.5px] mt-0.5">
                        {x.round_type ?? "Unspecified"} · {x.date}
                        {x.is_lead ? " · lead" : !x.round_has_lead_data ? " · lead unknown" : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono tabular-nums">{x.amount_usd != null ? usd(Number(x.amount_usd)) : <span className="text-muted-foreground">undisclosed</span>}</div>
                      {x.announcement_url && (
                        <a href={x.announcement_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                          source <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
