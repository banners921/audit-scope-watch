import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Mail, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

type BriefItem = {
  slug: string;
  name: string;
  logo: string | null;
  url: string | null;
  category: string | null;
  signal_kind: string;
  headline: string;
  detail: string;
  source_url: string | null;
  fired_at: string;
  priority: number;
};
type StateCard = {
  slug: string;
  name: string;
  logo: string | null;
  url: string | null;
  category: string | null;
  audit_count: number;
  last_audit_firm: string | null;
  last_audit_date: string | null;
  days_since_audit: number | null;
  firm_count: number;
  firms: string[];
  last_funding: {
    amount_usd: number | null;
    round_type: string | null;
    date: string | null;
    lead_investors: unknown;
    url: string | null;
  } | null;
  open_roles_count: number;
  open_roles_sample: Array<{ title: string | null; url: string | null; subtype: string | null }>;
  facts: string[];
  tags: string[];
  hook: string;
};
type BriefResp = {
  ok: boolean;
  empty: boolean;
  reason?: string;
  account_count: number;
  accounts_touched?: number;
  signals_count: number;
  items: BriefItem[];
  account_state?: StateCard[];
  html: string;
  text: string;
  debug?: {
    user_id_seen?: string;
    auth_mode?: string;
    saved_count?: number;
    saved_query_error?: { message?: string; code?: string; details?: string } | null;
    profile_found?: boolean;
  };
};

const KIND_BADGE: Record<string, string> = {
  "warm-funding": "bg-rose-500/15 text-rose-300 border-rose-500/40",
  funding: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "new-audit": "bg-sky-500/15 text-sky-300 border-sky-500/30",
  hiring: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "tvl-spike": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  github: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  hack: "bg-red-500/20 text-red-300 border-red-500/40",
};
function kindLabel(k: string): string {
  return (
    {
      "warm-funding": "🔥 Warm Lead",
      funding: "💸 Funded",
      "new-audit": "📝 New Audit",
      hiring: "👋 Hiring",
      "tvl-spike": "📊 TVL Move",
      github: "🛠️ GitHub",
      hack: "🚨 Hack",
    }[k] || "🔹 Signal"
  );
}
const TAG_BADGE: Record<string, string> = {
  "no-audits": "bg-red-500/15 text-red-300 border-red-500/30",
  "stale-audit": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "multi-firm": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "heavy-audit": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "fresh-audit": "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "active-program": "bg-white/[0.05] text-muted-foreground border-white/10",
  "warm-investor": "bg-rose-500/15 text-rose-300 border-rose-500/40",
  "hiring-security": "bg-amber-500/15 text-amber-300 border-amber-500/40",
};
function tagLabel(t: string): string {
  return ({
    "no-audits": "No audits",
    "stale-audit": "Stale audit",
    "multi-firm": "Multi-firm",
    "heavy-audit": "Heavy cadence",
    "fresh-audit": "Fresh audit",
    "active-program": "Active",
    "warm-investor": "🔥 Warm investor",
    "hiring-security": "👋 Security hire",
  }[t] || t);
}

export function DailyBriefPreview({ onClose }: { onClose: () => void }) {
  const [brief, setBrief] = useState<BriefResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lookback, setLookback] = useState<24 | 72 | 168>(168);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Sign in required");
        const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
        const res = await fetch(`${base}/functions/v1/compose-daily-brief`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lookback_hours: lookback }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
        }
        const j = (await res.json()) as BriefResp;
        if (cancelled) return;
        setBrief(j);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lookback]);

  const windowLbl = lookback === 24 ? "24h" : lookback === 72 ? "3d" : "7d";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-white/10 bg-[#0F1420] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <Mail className="w-4 h-4 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-white">Daily Brief preview</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Current state of your saved targets, plus what's new.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-white p-1 rounded hover:bg-white/[0.04]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-2.5 border-b border-white/[0.06] flex items-center gap-2 bg-white/[0.02]">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">What's new window</span>
          <div className="flex items-center gap-1 bg-white/[0.04] rounded-md p-0.5">
            {([24, 72, 168] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setLookback(h)}
                className={`text-[11px] px-2.5 py-1 rounded font-medium ${
                  lookback === h
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-white"
                }`}
              >
                {h === 24 ? "24h" : h === 72 ? "3d" : "7d"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Composing your brief…
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-destructive">{error}</div>
          ) : !brief ? null : brief.empty && brief.reason === "no_saved_targets" ? (
            <div className="py-12 text-center space-y-2">
              <div className="text-base text-white font-semibold">No saved targets yet</div>
              <div className="text-sm text-muted-foreground max-w-md mx-auto">
                Add a few accounts to your watch list and you'll start getting briefs with audit posture, hiring, funding, and TVL signals.
              </div>
              {brief.debug && (
                <details className="mt-6 text-left max-w-md mx-auto">
                  <summary className="text-[11px] text-muted-foreground/70 cursor-pointer hover:text-muted-foreground">
                    Show diagnostic info
                  </summary>
                  <pre className="mt-2 text-[10px] font-mono text-muted-foreground bg-white/[0.03] border border-white/[0.06] rounded p-2 overflow-auto">
                    {JSON.stringify(brief.debug, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="text-xs text-muted-foreground">
                <span className="text-white font-semibold">{brief.account_count}</span> saved target
                {brief.account_count === 1 ? "" : "s"} ·{" "}
                <span className="text-white font-semibold">{brief.signals_count}</span> update
                {brief.signals_count === 1 ? "" : "s"} in the last {windowLbl}.
              </div>

              {/* WHAT'S NEW */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  What's new ({windowLbl})
                </h3>
                {brief.items.length > 0 ? (
                  <ul className="space-y-2">
                    {brief.items.map((it, i) => (
                      <li
                        key={`${it.slug}-${i}`}
                        className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                              KIND_BADGE[it.signal_kind] ||
                              "bg-white/[0.04] text-muted-foreground border-white/10"
                            }`}
                          >
                            {kindLabel(it.signal_kind)}
                          </span>
                          {it.category && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground border border-white/[0.06]">
                              {it.category}
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-medium text-white mt-1.5">{it.headline}</div>
                        <div className="text-[12.5px] text-muted-foreground mt-1 leading-snug">
                          {it.detail}
                        </div>
                        {it.source_url && (
                          <a
                            href={it.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block mt-1.5 text-[11px] text-primary hover:underline"
                          >
                            View source →
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground italic">
                    No new movement on your saved accounts in the last {windowLbl}.
                  </p>
                )}
              </section>

              {/* ACCOUNT STATE */}
              {brief.account_state && brief.account_state.length > 0 && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                    Account state
                  </h3>
                  <ul className="space-y-2">
                    {brief.account_state.map((c) => (
                      <li
                        key={c.slug}
                        className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {c.logo && (
                            <img src={c.logo} alt="" className="w-5 h-5 rounded" />
                          )}
                          <span className="text-sm font-semibold text-white">{c.name}</span>
                          {c.category && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground border border-white/[0.06]">
                              {c.category}
                            </span>
                          )}
                          {c.tags.map((t) => (
                            <span
                              key={t}
                              className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                                TAG_BADGE[t] || "bg-white/[0.04] text-muted-foreground border-white/10"
                              }`}
                            >
                              {tagLabel(t)}
                            </span>
                          ))}
                          {c.url && (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-auto text-muted-foreground hover:text-white"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <ul className="mt-2 space-y-0.5">
                          {c.facts.map((f, i) => (
                            <li key={i} className="text-[12.5px] text-muted-foreground leading-snug">
                              · {f}
                            </li>
                          ))}
                        </ul>
                        {c.hook && (
                          <div className="mt-2 text-[12.5px] text-primary leading-snug">
                            → {c.hook}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Live preview · the real brief sends tomorrow morning to your email + Slack/Telegram.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
