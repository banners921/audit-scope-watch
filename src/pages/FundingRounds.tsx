import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ViewToggle, type ViewMode } from "@/components/ViewToggle";
import {
  RoundListRow,
  RoundGridCard,
  type FundingRoundRow,
} from "@/components/FundingRoundCard";

const PAGE_SIZE = 60;
const VIEW_KEY = "as_funding_rounds_view";

const ROUND_OPTIONS = [
  { label: "All rounds", value: "" },
  { label: "Pre-seed", value: "pre_seed" },
  { label: "Seed", value: "seed" },
  { label: "Series A", value: "series_a" },
  { label: "Series B", value: "series_b" },
  { label: "Series C", value: "series_c" },
  { label: "Strategic", value: "strategic" },
  { label: "Grant", value: "grant" },
];

const AMOUNT_OPTIONS = [
  { label: "Any amount", value: 0 },
  { label: "$1M+", value: 1_000_000 },
  { label: "$5M+", value: 5_000_000 },
  { label: "$20M+", value: 20_000_000 },
  { label: "$50M+", value: 50_000_000 },
];

const RECENCY_OPTIONS = [
  { label: "All time", value: 0 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
  { label: "Last 6 months", value: 180 },
  { label: "Last 12 months", value: 365 },
];

export default function FundingRounds() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [roundType, setRoundType] = useState("");
  const [minAmount, setMinAmount] = useState(0);
  const [recencyDays, setRecencyDays] = useState(0);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    return (window.localStorage.getItem(VIEW_KEY) as ViewMode) || "grid";
  });

  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [debounced, roundType, minAmount, recencyDays]);

  const rounds = useQuery({
    queryKey: ["funding-rounds", debounced, roundType, minAmount, recencyDays, page],
    queryFn: async () => {
      let q = supabase
        .from("funding_rounds")
        .select(
          "id,company_slug,company_name,round_type,amount_usd,date,lead_investors,other_investors,all_investors,announcement_url,category",
          { count: "exact" },
        )
        .order("date", { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (debounced) {
        q = q.or(`company_name.ilike.%${debounced}%,lead_investors.ilike.%${debounced}%,all_investors.ilike.%${debounced}%`);
      }
      if (roundType) q = q.eq("round_type", roundType);
      if (minAmount > 0) q = q.gte("amount_usd", minAmount);
      if (recencyDays > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - recencyDays);
        q = q.gte("date", cutoff.toISOString().slice(0, 10));
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as FundingRoundRow[], count: count ?? 0 };
    },
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((rounds.data?.count ?? 0) / PAGE_SIZE)),
    [rounds.data?.count],
  );

  const rows = rounds.data?.rows ?? [];

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div>
        <h2 className="text-xl font-bold text-white">Funding Rounds</h2>
        <p className="text-sm text-muted-foreground">
          {rounds.data ? `${rounds.data.count.toLocaleString()} rounds tracked` : "—"}
        </p>
      </div>

      <div className="as-card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by company or investor…"
              className="as-input pl-10"
            />
          </div>
          <ViewToggle value={view} onChange={setView} />
        </div>
        <div className="flex flex-wrap gap-2">
          <SelectFilter value={roundType} onChange={setRoundType} options={ROUND_OPTIONS.map((o) => ({ label: o.label, value: o.value }))} />
          <SelectFilter
            value={String(minAmount)}
            onChange={(v) => setMinAmount(Number(v))}
            options={AMOUNT_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) }))}
          />
          <SelectFilter
            value={String(recencyDays)}
            onChange={(v) => setRecencyDays(Number(v))}
            options={RECENCY_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) }))}
          />
        </div>
      </div>

      {rounds.isLoading ? (
        view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="as-card h-36 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="as-card p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-white/[0.03] rounded animate-pulse" />
            ))}
          </div>
        )
      ) : rows.length === 0 ? (
        <div className="as-card p-12 text-center text-sm text-muted-foreground">No rounds match these filters.</div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((r) => (
            <RoundGridCard key={r.id} r={r} />
          ))}
        </div>
      ) : (
        <div className="as-card p-4 space-y-2">
          {rows.map((r) => (
            <RoundListRow key={r.id} r={r} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span className="font-mono">
          {rounds.data?.count ?? 0} rounds • Page {page + 1} / {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            className="as-btn as-btn-ghost py-1 px-3 text-xs disabled:opacity-40"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <button
            className="as-btn as-btn-ghost py-1 px-3 text-xs disabled:opacity-40"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectFilter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs bg-white/[0.04] border border-white/10 rounded-md px-2 py-1.5 text-white outline-none hover:bg-white/[0.06] focus:border-primary"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
