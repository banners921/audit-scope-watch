import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Github, Twitter, Globe } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { supabase, type Protocol, type AuditRecord, type SignalAlert } from "@/lib/supabase";
import { formatTvl, formatPct, riskTier } from "@/lib/format";
import { SeverityBadge } from "@/components/RiskBadge";

function formatAuditDate(audit_date: string | null | undefined, ...urls: (string | null | undefined)[]): { text: string; unknown: boolean } {
  if (audit_date) {
    const d = new Date(audit_date);
    if (!isNaN(d.getTime())) return { text: format(d, "MMM yyyy"), unknown: false };
  }
  for (const url of urls) {
    if (!url) continue;
    const m = url.match(/(\d{4})[-_/](\d{1,2})(?:[-_/](\d{1,2}))?/);
    if (m) {
      const y = +m[1], mo = +m[2];
      if (y > 2000 && y < 2100 && mo >= 1 && mo <= 12) {
        return { text: format(new Date(y, mo - 1, 1), "MMM yyyy"), unknown: false };
      }
    }
  }
  return { text: "Date unknown", unknown: true };
}

function ScoreGauge({ score }: { score: number | null | undefined }) {
  const tier = riskTier(score);
  const color = tier === "high" ? "#EF4444" : tier === "medium" ? "#F59E0B" : tier === "low" ? "#10B981" : "#A0A8B8";
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="relative w-32 h-32">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={r} stroke="rgba(255,255,255,0.06)" strokeWidth="10" fill="none" />
        <circle
          cx="60" cy="60" r={r} stroke={color} strokeWidth="10" fill="none"
          strokeLinecap="round" strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-3xl font-bold text-white">{score ?? "—"}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Risk Score</span>
      </div>
    </div>
  );
}

export default function ProtocolDetail() {
  const { slug = "" } = useParams();

  const proto = useQuery({
    queryKey: ["protocol", slug],
    queryFn: async () => {
      const { data, error } = await supabase.from("protocols").select("*").eq("slug", slug).maybeSingle();
      if (error) throw error;
      return data as Protocol | null;
    },
  });

  const audits = useQuery({
    queryKey: ["audits", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_history")
        .select("*")
        .eq("protocol_slug", slug)
        .order("audit_date", { ascending: false });
      if (error) throw error;
      return data as AuditRecord[];
    },
  });

  const signals = useQuery({
    queryKey: ["protocol-signals", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signal_alerts")
        .select("*")
        .eq("protocol_slug", slug)
        .order("fired_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as SignalAlert[];
    },
  });

  if (proto.isLoading) return <div className="text-muted-foreground">Loading protocol…</div>;
  if (!proto.data) return <div className="text-muted-foreground">Protocol not found.</div>;

  const p = proto.data;
  const change = p.tvl_7d_change ?? null;

  return (
    <div className="space-y-5 max-w-[1400px]">
      <Link to="/protocols" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-white">
        <ArrowLeft className="w-3 h-3" /> Back to protocols
      </Link>

      <div className="as-card p-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {p.logo ? (
              <img src={p.logo} alt="" className="w-14 h-14 rounded-xl bg-white/5" />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-white/5" />
            )}
            <div className="min-w-0">
              <h2 className="text-2xl font-bold text-white truncate">{p.name}</h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {p.category && <span className="text-xs px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{p.category}</span>}
                {p.chains?.map((c) => (
                  <span key={c} className="text-xs px-2 py-0.5 rounded-md bg-white/5 text-muted-foreground border border-white/10">{c}</span>
                ))}
              </div>
              {p.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{p.description}</p>}
              <div className="flex items-center gap-3 mt-3">
                {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Globe className="w-4 h-4" /></a>}
                {p.twitter && <a href={p.twitter} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Twitter className="w-4 h-4" /></a>}
                {p.github?.[0] && <a href={p.github[0]} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Github className="w-4 h-4" /></a>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-8">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">TVL</div>
              <div className="font-mono text-3xl font-bold text-white">{formatTvl(p.tvl_usd)}</div>
              <div className={`font-mono text-sm ${change == null ? "text-muted-foreground" : change >= 0 ? "text-success" : "text-destructive"}`}>
                {formatPct(change)} 7d
              </div>
            </div>
            <ScoreGauge score={p.security_score} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* AUDIT HISTORY */}
        <div className="as-card p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Audit History</h3>
          {audits.isLoading ? (
            <div className="h-24 bg-white/[0.03] rounded animate-pulse" />
          ) : audits.data && audits.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr><th className="text-left py-2">Firm</th><th className="text-left py-2">Date</th><th className="text-left py-2">Type</th><th className="text-left py-2">Findings</th><th className="text-right py-2">Report</th></tr>
                </thead>
                <tbody>
                  {audits.data.map((a) => {
                    const rec = a as AuditRecord & { source_link?: string | null };
                    const displayDate = formatAuditDate(a.audit_date, a.report_url, rec.source_link);
                    const c = a.findings_critical ?? 0;
                    const h = a.findings_high ?? 0;
                    const m = a.findings_medium ?? 0;
                    const hasFindings = c + h + m > 0;
                    return (
                    <tr key={a.id} className="border-t border-white/[0.04]">
                      <td className="py-2 text-white">{a.audit_firm || "—"}</td>
                      <td className={`py-2 font-mono text-xs ${displayDate.unknown ? "text-muted-foreground/60" : "text-muted-foreground"}`}>{displayDate.text}</td>
                      <td className="py-2 text-muted-foreground">{a.audit_type || "—"}</td>
                      <td className="py-2 font-mono text-xs">
                        {hasFindings ? (
                          <span className="space-x-1.5">
                            <span className="text-destructive">{c}C</span>
                            <span className="text-warning">{h}H</span>
                            <span className="text-muted-foreground">{m}M</span>
                          </span>
                        ) : "—"}
                      </td>
                      <td className="py-2 text-right">
                        {a.report_url ? (
                          <a href={a.report_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 text-xs">
                            View <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : "—"}
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-lg p-4 text-sm font-medium">
              Never Audited — High Priority
            </div>
          )}
        </div>

        {/* HACK HISTORY */}
        <div className="as-card p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Hack History</h3>
          {p.has_been_hacked ? (
            <div className="bg-warning/10 border border-warning/30 text-warning rounded-lg p-4">
              <div className="text-sm font-semibold">Hacked {p.hack_count ?? 1} time{(p.hack_count ?? 1) > 1 ? "s" : ""}</div>
              <div className="text-xs mt-1 opacity-80">This protocol has known historical exploits.</div>
            </div>
          ) : (
            <div className="bg-success/10 border border-success/30 text-success rounded-lg p-4 text-sm font-medium">
              No known exploits
            </div>
          )}
        </div>

        {/* BUG BOUNTY */}
        <div className="as-card p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Bug Bounty</h3>
          {p.has_bug_bounty ? (
            <div className="bg-primary/10 border border-primary/30 text-primary rounded-lg p-4">
              <div className="text-sm font-semibold font-mono">
                Active — Max {p.bug_bounty_amount ? formatTvl(p.bug_bounty_amount) : "—"}
              </div>
              {p.bug_bounty_url && (
                <a href={p.bug_bounty_url} target="_blank" rel="noreferrer" className="text-xs hover:underline inline-flex items-center gap-1 mt-2">
                  Program details <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ) : (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-lg p-4 text-sm font-medium">
              No bug bounty program
            </div>
          )}
        </div>

        {/* RECENT SIGNALS */}
        <div className="as-card p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Recent Signals</h3>
          {signals.isLoading ? (
            <div className="h-24 bg-white/[0.03] rounded animate-pulse" />
          ) : signals.data && signals.data.length > 0 ? (
            <div className="divide-y divide-white/[0.05]">
              {signals.data.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="font-mono text-xs text-white truncate">{s.alert_type}</div>
                  <div className="flex items-center gap-3 shrink-0">
                    <SeverityBadge severity={s.severity} />
                    <span className="text-xs text-muted-foreground font-mono">
                      {formatDistanceToNow(new Date(s.fired_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4">No signals recorded</div>
          )}
        </div>
      </div>

      {p.last_audit_date && (
        <div className="text-xs text-muted-foreground font-mono">
          Last audit: {p.last_audit_firm || "—"} on {format(new Date(p.last_audit_date), "yyyy-MM-dd")}
        </div>
      )}
    </div>
  );
}
