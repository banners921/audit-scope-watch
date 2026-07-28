import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, FileCheck } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { fetchLlamaProtocol } from "@/lib/liveData";
import { formatTvl } from "@/lib/format";
import { RemindButton } from "@/components/RemindButton";

type Props = {
  onSelectCompany: (slug: string) => void;
};

type InstitutionSignal = {
  id: string;
  institution_slug: string;
  signal_type: string;
  signal_title: string;
  signal_detail: string | null;
  severity: string | null;
  fired_at: string;
  institution_name?: string;
};

type ProtocolRow = {
  slug: string;
  name: string;
  logo: string | null;
  last_audit_date: string | null;
  parent_slug: string | null;
};

function severityDot(severity: string | null | undefined): string {
  switch ((severity || "").toLowerCase()) {
    case "critical":
      return "bg-red-500";
    case "high":
      return "bg-orange-400";
    case "medium":
      return "bg-yellow-400";
    case "low":
      return "bg-blue-400";
    default:
      return "bg-white/40";
  }
}

function monthsSince(d: string | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24 * 30));
}

type AuditFeedRow = {
  id: string;
  audit_firm: string | null;
  audit_date: string | null;
  protocol_slug: string | null;
  protocol_name: string | null;
  company_slug: string | null;
  smart_contract_language: string | null;
  report_url: string | null;
  parent_slug: string | null;
  display_company_slug: string | null;
  display_company_name: string | null;
};

export function SignalsFeed({ onSelectCompany }: Props) {
  const [tab, setTab] = useState<"audits" | "institutions" | "protocols">("audits");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const auditFeed = useQuery({
    queryKey: ["dashboard-audit-feed"],
    enabled: tab === "audits",
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<AuditFeedRow[]> => {
      const { data, error } = await supabase
        .from("audit_history")
        .select("id,audit_firm,audit_date,protocol_slug,protocol_name,company_slug,smart_contract_language,report_url")
        .not("audit_date", "is", null)
        .order("audit_date", { ascending: false })
        .limit(40);
      if (error) throw error;
      const rows = (data || []) as AuditFeedRow[];

      // Resolve display company (prefer company_slug, fall back to protocol's parent_slug).
      const needsParent = rows.filter((r) => !r.company_slug && r.protocol_slug).map((r) => r.protocol_slug!) as string[];
      const parentMap = new Map<string, string | null>();
      if (needsParent.length > 0) {
        const { data: protos } = await supabase
          .from("protocols")
          .select("slug,parent_slug")
          .in("slug", needsParent);
        (protos || []).forEach((p: { slug: string; parent_slug: string | null }) =>
          parentMap.set(p.slug, p.parent_slug),
        );
      }
      const slugsForName = new Set<string>();
      rows.forEach((r) => {
        const cs = r.company_slug || (r.protocol_slug ? parentMap.get(r.protocol_slug) ?? null : null);
        if (cs) slugsForName.add(cs);
      });
      const nameMap = new Map<string, string>();
      if (slugsForName.size > 0) {
        const { data: comps } = await supabase
          .from("companies")
          .select("slug,name")
          .in("slug", Array.from(slugsForName));
        (comps || []).forEach((c: { slug: string; name: string }) => nameMap.set(c.slug, c.name));
      }
      return rows.map((r) => {
        const cs = r.company_slug || (r.protocol_slug ? parentMap.get(r.protocol_slug) ?? null : null);
        return {
          ...r,
          display_company_slug: cs,
          display_company_name: cs ? nameMap.get(cs) ?? null : null,
        };
      });
    },
  });

  const institutionSignals = useQuery({
    queryKey: ["dashboard-institution-signals"],
    enabled: tab === "institutions",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("institution_signals")
        .select("id,institution_slug,signal_type,signal_title,signal_detail,severity,fired_at,institutions!inner(name)")
        .order("fired_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        institution_slug: r.institution_slug as string,
        signal_type: r.signal_type as string,
        signal_title: r.signal_title as string,
        signal_detail: r.signal_detail as string | null,
        severity: r.severity as string | null,
        fired_at: r.fired_at as string,
        institution_name: (r.institutions as { name?: string } | null)?.name,
      })) as InstitutionSignal[];
    },
  });

  const protocolSignals = useQuery({
    queryKey: ["dashboard-protocol-signals"],
    enabled: tab === "protocols",
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 6);
      const { data, error } = await supabase
        .from("protocols")
        .select("slug,name,logo,last_audit_date,parent_slug")
        .lt("last_audit_date", cutoff.toISOString().slice(0, 10))
        .not("parent_slug", "is", null)
        .limit(60);
      if (error) throw error;
      return (data || []) as ProtocolRow[];
    },
  });

  return (
    <div className="as-card flex flex-col h-full overflow-hidden" style={{ background: "#0F1420", borderColor: "rgba(255,255,255,0.08)" }}>
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-white">Live Signals</h3>
        </div>
        <div className="flex items-center gap-1 bg-white/[0.04] rounded-md p-0.5">
          <button
            type="button"
            onClick={() => setTab("audits")}
            className={`text-xs px-3 py-1 rounded ${
              tab === "audits" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
            }`}
          >
            Audits
          </button>
          <button
            type="button"
            onClick={() => setTab("institutions")}
            className={`text-xs px-3 py-1 rounded ${
              tab === "institutions" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
            }`}
          >
            Institutions
          </button>
          <button
            type="button"
            onClick={() => setTab("protocols")}
            className={`text-xs px-3 py-1 rounded ${
              tab === "protocols" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
            }`}
          >
            Protocols
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "audits" ? (
          auditFeed.isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-white/[0.03] rounded animate-pulse" />
              ))}
            </div>
          ) : !auditFeed.data || auditFeed.data.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No recent audits yet</div>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {auditFeed.data.map((a) => (
                <AuditFeedRowItem key={a.id} a={a} onSelectCompany={onSelectCompany} />
              ))}
            </ul>
          )
        ) : tab === "institutions" ? (
          institutionSignals.isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 bg-white/[0.03] rounded animate-pulse" />
              ))}
            </div>
          ) : !institutionSignals.data || institutionSignals.data.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No institution signals yet</div>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {institutionSignals.data.map((s) => {
                const open = expandedId === s.id;
                return (
                  <li key={s.id} className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(open ? null : s.id)}
                      className="w-full flex items-center gap-3 text-left"
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${severityDot(s.severity)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-white truncate">
                          {s.institution_name || s.institution_slug}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{s.signal_title}</div>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(s.fired_at), { addSuffix: true })}
                      </span>
                      <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                    {open && s.signal_detail && (
                      <div className="mt-2 ml-5 text-xs text-muted-foreground bg-white/[0.02] border border-white/[0.04] rounded p-2 whitespace-pre-wrap">
                        {s.signal_detail}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        ) : protocolSignals.isLoading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-white/[0.03] rounded animate-pulse" />
            ))}
          </div>
        ) : !protocolSignals.data || protocolSignals.data.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No stale-audit signals</div>
        ) : (
          <ProtocolSignalList rows={protocolSignals.data} onSelectCompany={onSelectCompany} />
        )}
      </div>
    </div>
  );
}

function AuditFeedRowItem({
  a,
  onSelectCompany,
}: {
  a: AuditFeedRow;
  onSelectCompany: (slug: string) => void;
}) {
  const dateStr = a.audit_date ? format(new Date(a.audit_date), "MMM d, yyyy") : "Date unknown";
  const companyLabel = a.display_company_name || a.display_company_slug || a.protocol_name;
  return (
    <li className="px-3 py-2 flex items-start gap-3 hover:bg-white/[0.03] transition-colors">
      <FileCheck className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => a.display_company_slug && onSelectCompany(a.display_company_slug)}
          disabled={!a.display_company_slug}
          className="text-left max-w-full"
        >
          <div className="text-xs text-white truncate">
            <span className="font-semibold">{a.audit_firm || "Audit"}</span>
            <span className="text-muted-foreground"> audited </span>
            <span className="font-semibold">{a.protocol_name || a.protocol_slug || "—"}</span>
            {companyLabel && companyLabel !== a.protocol_name && (
              <span className="text-muted-foreground"> ({companyLabel})</span>
            )}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
            {dateStr}
            {a.smart_contract_language ? ` · ${a.smart_contract_language}` : ""}
          </div>
        </button>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {a.report_url && (
          <a
            href={a.report_url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-muted-foreground hover:text-primary px-1.5 py-1 rounded border border-white/10 hover:border-white/20 bg-white/[0.03]"
          >
            Report
          </a>
        )}
        {a.display_company_slug && (
          <RemindButton
            companySlug={a.display_company_slug}
            companyName={a.display_company_name}
            source="audit_feed"
            compact
          />
        )}
      </div>
    </li>
  );
}

function ProtocolSignalList({
  rows,
  onSelectCompany,
}: {
  rows: ProtocolRow[];
  onSelectCompany: (slug: string) => void;
}) {
  return (
    <ul className="divide-y divide-white/[0.04]">
      {rows.map((p) => (
        <ProtocolSignalRow key={p.slug} p={p} onSelectCompany={onSelectCompany} />
      ))}
    </ul>
  );
}

function ProtocolSignalRow({
  p,
  onSelectCompany,
}: {
  p: ProtocolRow;
  onSelectCompany: (slug: string) => void;
}) {
  const tvl = useQuery({
    queryKey: ["signal-tvl", p.slug],
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchLlamaProtocol(p.slug).then((r) => r.tvl),
  });

  // Spec says: tvl_usd > 500000 — apply client-side as we don't have a stored TVL column.
  if (!tvl.isLoading && (tvl.data == null || tvl.data <= 500_000)) return null;

  const m = monthsSince(p.last_audit_date) ?? 0;

  return (
    <li
      onClick={() => p.parent_slug && onSelectCompany(p.parent_slug)}
      className="px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-white/[0.03] transition-colors"
    >
      <span className="w-2 h-2 rounded-full shrink-0 bg-orange-400" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-white truncate">
          <span className="font-semibold">{p.name}</span>{" "}
          <span className="text-muted-foreground">
            — {tvl.isLoading ? "loading…" : formatTvl(tvl.data ?? null)} TVL, {m} months since audit
          </span>
        </div>
      </div>
    </li>
  );
}
