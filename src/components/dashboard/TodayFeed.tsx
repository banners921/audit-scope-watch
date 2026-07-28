import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchUserProfile,
  fetchSavedSlugs,
  fetchReminderSignals,
  fetchRecentAuditSignals,
  fetchStaleAuditSignals,
  fetchFundingSignals,
  fetchWarmLeadSignals,
  mergeSignals,
  type Signal,
  type SignalType,
} from "@/lib/signals";
import { SignalCard } from "./SignalCard";

type FilterKey = "all" | "reminders" | "audits" | "funding" | "warm";

const FILTERS: Array<{ key: FilterKey; label: string; matches: SignalType[] }> = [
  { key: "all", label: "All", matches: [] },
  { key: "reminders", label: "Reminders", matches: ["reminder_due"] },
  { key: "audits", label: "Audit signals", matches: ["recent_audit", "stale_audit", "never_audited"] },
  { key: "funding", label: "Funding", matches: ["recent_funding"] },
  { key: "warm", label: "Warm leads", matches: ["warm_lead"] },
];

const SNOOZE_KEY = "as_today_snoozed_v1";

type Props = {
  onSelectCompany: (slug: string) => void;
};

export function TodayFeed({ onSelectCompany }: Props) {
  const { user } = useAuth();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [snoozed, setSnoozed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = JSON.parse(window.localStorage.getItem(SNOOZE_KEY) || "[]") as string[];
      return new Set(stored);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(Array.from(snoozed)));
  }, [snoozed]);

  const profileQ = useQuery({
    queryKey: ["today-feed-profile", user?.id],
    enabled: !!user,
    queryFn: () => fetchUserProfile(user!.id),
  });

  const savedQ = useQuery({
    queryKey: ["today-feed-saved", user?.id],
    enabled: !!user,
    queryFn: () => fetchSavedSlugs(user!.id),
  });

  const profile = profileQ.data;
  const savedSlugs = savedQ.data || new Set<string>();
  const trackedSlugs = useMemo(() => new Set(profile?.ideal_target_slugs || []), [profile?.ideal_target_slugs]);
  const existingClients = useMemo(() => new Set(profile?.existing_client_slugs || []), [profile?.existing_client_slugs]);
  const investors = profile?.investors || [];

  const remindersQ = useQuery({
    queryKey: ["today-feed-reminders", user?.id],
    enabled: !!user,
    queryFn: () => fetchReminderSignals(user!.id),
  });

  const recentAuditsQ = useQuery({
    queryKey: ["today-feed-recent-audits", Array.from(savedSlugs).join(","), Array.from(trackedSlugs).join(",")],
    enabled: !!user && (savedSlugs.size > 0 || trackedSlugs.size > 0),
    queryFn: () => fetchRecentAuditSignals({ savedSlugs, trackedSlugs }),
  });

  const staleAuditsQ = useQuery({
    queryKey: ["today-feed-stale", Array.from(savedSlugs).join(","), Array.from(trackedSlugs).join(",")],
    enabled: !!user,
    queryFn: () => fetchStaleAuditSignals({ savedSlugs, trackedSlugs, existingClients }),
  });

  const fundingQ = useQuery({
    queryKey: ["today-feed-funding"],
    enabled: !!user,
    queryFn: () => fetchFundingSignals({ existingClients, minAmount: 1_000_000 }),
  });

  const warmQ = useQuery({
    queryKey: ["today-feed-warm", investors.join("|")],
    enabled: !!user && investors.length > 0,
    queryFn: () => fetchWarmLeadSignals({ investors, savedSlugs, existingClients }),
  });

  const loading = profileQ.isLoading || remindersQ.isLoading || staleAuditsQ.isLoading || fundingQ.isLoading;

  const merged = useMemo<Signal[]>(() => {
    const all = mergeSignals([
      remindersQ.data || [],
      recentAuditsQ.data || [],
      staleAuditsQ.data || [],
      fundingQ.data || [],
      warmQ.data || [],
    ]);
    return all;
  }, [remindersQ.data, recentAuditsQ.data, staleAuditsQ.data, fundingQ.data, warmQ.data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const active = FILTERS.find((f) => f.key === filter)!;
    return merged.filter((s) => {
      if (snoozed.has(s.id)) return false;
      if (active.matches.length > 0 && !active.matches.includes(s.type)) return false;
      if (q && !`${s.company_name} ${s.reason}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [merged, filter, search, snoozed]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, reminders: 0, audits: 0, funding: 0, warm: 0 };
    for (const s of merged) {
      if (snoozed.has(s.id)) continue;
      c.all++;
      for (const f of FILTERS) {
        if (f.matches.includes(s.type)) c[f.key]++;
      }
    }
    return c;
  }, [merged, snoozed]);

  function snooze(id: string) {
    setSnoozed((prev) => new Set(prev).add(id));
  }

  function unsnoozeAll() {
    setSnoozed(new Set());
  }

  function refetchAll() {
    remindersQ.refetch();
    recentAuditsQ.refetch();
    staleAuditsQ.refetch();
    fundingQ.refetch();
    warmQ.refetch();
  }

  const dueCount = (remindersQ.data || []).filter((r) => !snoozed.has(r.id)).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Today</h1>
          <div className="text-xs font-mono text-muted-foreground mt-1">
            {format(new Date(), "EEEE · MMM d, yyyy")}
            {" · "}
            {counts.all} action{counts.all === 1 ? "" : "s"} ranked
            {dueCount > 0 && <span className="ml-2 text-amber-300">· {dueCount} due now</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {snoozed.size > 0 && (
            <button
              type="button"
              onClick={unsnoozeAll}
              className="text-[11px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-white"
            >
              Show {snoozed.size} hidden
            </button>
          )}
          <button
            type="button"
            onClick={refetchAll}
            disabled={loading}
            className="text-[11px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-white disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by company or reason…"
            className="as-input pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 bg-white/[0.04] rounded-md p-0.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`text-[11px] px-2.5 py-1 rounded inline-flex items-center gap-1 ${
                filter === f.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
              }`}
            >
              {f.label} <span className="opacity-50">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Helpful nudges when empty */}
      {!loading && visible.length === 0 && (
        <div className="as-card p-8 text-center space-y-2" style={{ background: "#0F1420", borderColor: "rgba(255,255,255,0.08)" }}>
          <SlidersHorizontal className="w-6 h-6 text-muted-foreground mx-auto" />
          <div className="text-sm text-muted-foreground">
            {merged.length === 0 ? (
              <>
                No signals yet. {investors.length === 0 ? <>Add your firm's investors in <a className="text-primary hover:underline" href="/profile">Profile</a> to unlock warm leads.</> : "Try saving a few targets so audit signals on them surface here."}
              </>
            ) : (
              "No signals match this filter."
            )}
          </div>
        </div>
      )}

      {/* Feed */}
      {loading && merged.length === 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="as-card h-32 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visible.map((s) => (
            <SignalCard
              key={s.id}
              signal={s}
              isSaved={savedSlugs.has(s.company_slug)}
              isSnoozed={snoozed.has(s.id)}
              onSelect={onSelectCompany}
              onSnooze={snooze}
            />
          ))}
        </div>
      )}
    </div>
  );
}
