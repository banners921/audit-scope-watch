import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Building2, Eye, Bell, Save, ExternalLink, Trash2, Wallet, ShieldCheck, Globe, Slack, Send, Loader2, Sparkles, CheckCircle2, Target as TargetIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { AsyncAutocomplete, type AutocompleteOption } from "@/components/AsyncAutocomplete";
import { BrandLogo } from "@/components/BrandLogo";
import { SearchableSelect, type Option } from "@/components/SearchableSelect";

type Persona = "fund" | "security";
type NotifChannel = "slack" | "telegram" | "both" | "none";

type Profile = {
  role: string | null;
  firm_type: string | null;
  company_name: string | null;
  company_url: string | null;
  company_description: string | null;
  sells_what: string | null;
  value_prop: string | null;
  specialties: string[] | null;
  focus_categories: string[] | null;
  target_chains: string[] | null;
  min_tvl_usd: number | null;
  hide_existing_clients: boolean | null;
  existing_client_slugs: string[] | null;
  disqualifiers: string[] | null;
  icp_summary: string | null;
  fund_slug: string | null;
  watched_fund_slugs: string[] | null;
  slack_webhook_url: string | null;
  telegram_bot_token: string | null;
  telegram_chat_id: string | null;
  notification_channel: NotifChannel | null;
};

const COMMON_CHAINS = [
  "Ethereum", "Solana", "Bitcoin", "Polygon", "Arbitrum", "Optimism", "Base", "BNB Chain",
  "Avalanche", "Cosmos", "Polkadot", "Sui", "Aptos", "Starknet", "zkSync", "Linea",
  "Cardano", "Near", "Tron", "Move (Aptos/Sui)", "Cairo (Starknet)", "Rust (Solana/Substrate)",
];

export default function ProfilePage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const profileQ = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Profile | null> => {
      const { data } = await supabase
        .from("user_profiles")
        .select("role,firm_type,company_name,company_url,company_description,sells_what,value_prop,specialties,focus_categories,target_chains,min_tvl_usd,hide_existing_clients,existing_client_slugs,disqualifiers,icp_summary,fund_slug,watched_fund_slugs,slack_webhook_url,telegram_bot_token,telegram_chat_id,notification_channel")
        .eq("user_id", user!.id)
        .maybeSingle();
      return (data ?? null) as Profile | null;
    },
  });

  const [persona, setPersona] = useState<Persona>("security");
  const [fundSlug, setFundSlug] = useState<string | null>(null);
  const [fundName, setFundName] = useState<string | null>(null);
  const [watchedFundSlugs, setWatchedFundSlugs] = useState<string[]>([]);
  const [watchedFundNames, setWatchedFundNames] = useState<Record<string, string>>({});

  // Security firm fields
  const [companyUrl, setCompanyUrl] = useState("");
  const [firmName, setFirmName] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [sellsWhat, setSellsWhat] = useState("");
  const [focusCategories, setFocusCategories] = useState<string[]>([]);
  const [targetChains, setTargetChains] = useState<string[]>([]);
  const [minRaisedUsd, setMinRaisedUsd] = useState<string>("");
  const [hideExisting, setHideExisting] = useState<boolean>(false);
  const [existingClients, setExistingClients] = useState<string[]>([]);

  // Notification fields
  const [notifChannel, setNotifChannel] = useState<NotifChannel>("slack");
  const [slackUrl, setSlackUrl] = useState("");
  const [tgToken, setTgToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [testingNotif, setTestingNotif] = useState(false);

  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (bootstrapped || !profileQ.data) return;
    const p = profileQ.data;
    if (p.firm_type === "security_firm" || p.firm_type === "security_tooling" || p.role === "auditor" || p.role === "tooling") {
      setPersona("security");
    } else if (p.fund_slug) {
      setPersona("fund");
    } else {
      setPersona("security");
    }
    setFundSlug(p.fund_slug ?? null);
    setWatchedFundSlugs(p.watched_fund_slugs ?? []);
    setFirmName(p.company_name ?? "");
    setCompanyUrl(p.company_url ?? "");
    setCompanyDescription(p.company_description ?? "");
    setSellsWhat(p.sells_what ?? "");
    setFocusCategories(p.focus_categories ?? []);
    setTargetChains(p.target_chains ?? []);
    setMinRaisedUsd(p.min_tvl_usd ? String(p.min_tvl_usd) : "");
    setHideExisting(!!p.hide_existing_clients);
    setExistingClients(p.existing_client_slugs ?? []);
    setSlackUrl(p.slack_webhook_url ?? "");
    setTgToken(p.telegram_bot_token ?? "");
    setTgChatId(p.telegram_chat_id ?? "");
    setNotifChannel(p.notification_channel ?? (p.slack_webhook_url ? "slack" : "none"));
    setBootstrapped(true);
  }, [profileQ.data, bootstrapped]);

  // Pull all distinct company categories so the ICP dropdown lists EVERY option
  const allCategoriesQ = useQuery({
    queryKey: ["companies-all-categories"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Option[]> => {
      const { data } = await supabase.from("companies").select("category").not("category", "is", null).limit(50000);
      const tally = new Map<string, number>();
      for (const r of (data ?? []) as any[]) if (r.category) tally.set(r.category, (tally.get(r.category) ?? 0) + 1);
      return Array.from(tally.entries()).sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ value: v, label: v, count: c }));
    },
  });

  const chainOptions: Option[] = COMMON_CHAINS.map((c) => ({ value: c, label: c }));

  // Fund metadata for fund persona
  const fundNameLookupQ = useQuery({
    queryKey: ["profile-fund-names", fundSlug, ...watchedFundSlugs.sort()],
    enabled: !!(fundSlug || watchedFundSlugs.length > 0),
    queryFn: async () => {
      const slugs = [fundSlug, ...watchedFundSlugs].filter(Boolean) as string[];
      if (slugs.length === 0) return {} as Record<string, { name: string; website: string | null; logo: string | null }>;
      const { data } = await supabase.from("funds").select("slug,name,website,logo").in("slug", slugs);
      const map: Record<string, { name: string; website: string | null; logo: string | null }> = {};
      for (const r of (data ?? []) as any[]) map[r.slug] = { name: r.name, website: r.website, logo: r.logo };
      return map;
    },
  });

  useEffect(() => {
    if (!fundNameLookupQ.data) return;
    if (fundSlug && fundNameLookupQ.data[fundSlug]) setFundName(fundNameLookupQ.data[fundSlug].name);
    const wn: Record<string, string> = {};
    for (const s of watchedFundSlugs) if (fundNameLookupQ.data[s]) wn[s] = fundNameLookupQ.data[s].name;
    setWatchedFundNames(wn);
  }, [fundNameLookupQ.data, fundSlug, watchedFundSlugs]);

  const fundSearch = useCallback(async (q: string): Promise<AutocompleteOption[]> => {
    if (q.trim().length < 2) return [];
    const { data } = await supabase
      .from("funds")
      .select("slug,name,website,investment_count")
      .ilike("name", `%${q}%`)
      .order("investment_count", { ascending: false, nullsFirst: false })
      .limit(20);
    return ((data ?? []) as any[])
      .filter((r) => !!r.slug)
      .map((r) => ({
        value: r.slug,
        label: r.investment_count ? `${r.name} · ${r.investment_count} deals` : r.name,
        sublabel: r.website || undefined,
      }));
  }, []);

  // 1. Light auto-scrape (Jina) for what they sell + name guess
  const scrapeMut = useMutation({
    mutationFn: async (url: string) => {
      const { data, error } = await supabase.functions.invoke("scrape-vendor-site", { body: { url } });
      if (error) throw error;
      return data as { firm_name_guess: string | null; tags: string[]; what_they_sell: string | null; summary: string | null };
    },
    onSuccess: (data) => {
      if (data.firm_name_guess && !firmName) setFirmName(data.firm_name_guess);
      if (data.what_they_sell && !sellsWhat) setSellsWhat(data.what_they_sell);
      if (data.summary && !companyDescription) setCompanyDescription(data.summary);
      toast.success("Scanned");
    },
    onError: (e: any) => toast.error(e?.message || "Scan failed"),
  });

  // 2. Deep Orthogonal enrichment for the user's firm itself
  const enrichSelfMut = useMutation({
    mutationFn: async (url: string) => {
      // Use the firm name as a pseudo-slug so we can store enrichment for them
      const slug = (firmName || url.replace(/^https?:\/\//, "").replace(/[^\w]/g, "_")).toLowerCase().slice(0, 60);
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("https://qktjbtmcjrwzmtqnszbq.supabase.co/functions/v1/enrich-company-max", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ company_slug: `firm_${slug}`, domain: url, force: false }),
      });
      if (!r.ok) throw new Error(`enrich ${r.status}`);
      return await r.json();
    },
    onSuccess: (data) => {
      const s = data?.signal_summary || {};
      if (s.description && !companyDescription) setCompanyDescription(s.description);
      if (s.industry && !sellsWhat) setSellsWhat(s.industry);
      const dm = s.decision_maker_emails?.length || 0;
      const team = s.employee_count;
      toast.success(`Enriched: ${team ? team + " employees, " : ""}${dm} contacts`);
    },
    onError: (e: any) => toast.error(`Deep enrich: ${e?.message || "failed"}`),
  });

  const handleScrape = () => {
    if (!companyUrl.trim()) { toast.error("Enter your website first"); return; }
    scrapeMut.mutate(companyUrl.trim());
    enrichSelfMut.mutate(companyUrl.trim());
  };

  // Test notification
  const testNotif = async () => {
    setTestingNotif(true);
    try {
      let ok = false;
      const text = `:sparkles: AuditScope test alert from ${firmName || "your firm"} — your channel is wired up.`;
      if ((notifChannel === "slack" || notifChannel === "both") && slackUrl) {
        const r = await fetch(slackUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        if (r.ok) ok = true;
      }
      if ((notifChannel === "telegram" || notifChannel === "both") && tgToken && tgChatId) {
        const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: tgChatId, text }),
        });
        if (r.ok) ok = true;
      }
      if (ok) toast.success("Test message sent — check your channel");
      else toast.error("No channel configured or send failed");
    } finally { setTestingNotif(false); }
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("not authenticated");
      const payload: Record<string, any> = {
        user_id: user.id,
        slack_webhook_url: slackUrl.trim() || null,
        telegram_bot_token: tgToken.trim() || null,
        telegram_chat_id: tgChatId.trim() || null,
        notification_channel: notifChannel,
        updated_at: new Date().toISOString(),
      };
      if (persona === "fund") {
        payload.role = "fund";
        payload.firm_type = "investor";
        payload.fund_slug = fundSlug;
        payload.watched_fund_slugs = watchedFundSlugs.length > 0 ? watchedFundSlugs : null;
        payload.company_name = null;
        payload.company_url = null;
        payload.company_description = null;
        payload.sells_what = null;
        payload.value_prop = null;
        payload.specialties = null;
        payload.focus_categories = null;
        payload.target_chains = null;
        payload.min_tvl_usd = null;
        payload.hide_existing_clients = false;
        payload.existing_client_slugs = null;
        payload.disqualifiers = null;
        payload.icp_summary = null;
      } else {
        payload.role = "auditor";
        payload.firm_type = "security_firm";
        payload.company_name = firmName.trim() || null;
        payload.company_url = companyUrl.trim() || null;
        payload.company_description = companyDescription.trim() || null;
        payload.sells_what = sellsWhat.trim() || null;
        payload.focus_categories = focusCategories.length > 0 ? focusCategories : null;
        payload.target_chains = targetChains.length > 0 ? targetChains : null;
        payload.min_tvl_usd = minRaisedUsd ? Number(minRaisedUsd) : null;
        payload.hide_existing_clients = hideExisting;
        payload.existing_client_slugs = existingClients.length > 0 ? existingClients : null;
        payload.fund_slug = null;
        payload.watched_fund_slugs = null;
      }
      const { data, error } = await supabase
        .from("user_profiles")
        .upsert(payload, { onConflict: "user_id" })
        .select("role,fund_slug,firm_type")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast.success("Profile saved");
      await Promise.all([
        qc.refetchQueries({ queryKey: ["profile", user?.id] }),
        qc.refetchQueries({ queryKey: ["dashboard-profile-min", user?.id] }),
        qc.refetchQueries({ queryKey: ["target-feed-init", user?.id] }),
      ]);
    },
    onError: (e: any) => toast.error(e?.message || "Save failed"),
  });

  const portfolioPreviewQ = useQuery({
    queryKey: ["profile-portfolio-preview", fundSlug],
    enabled: persona === "fund" && !!fundSlug,
    queryFn: async () => {
      const { data } = await supabase
        .from("fund_portfolio")
        .select("company_slug,company_name,round_type,amount_usd,round_date")
        .eq("fund_slug", fundSlug!)
        .order("round_date", { ascending: false, nullsFirst: false })
        .limit(8);
      return (data ?? []) as any[];
    },
  });

  const portfolioCountQ = useQuery({
    queryKey: ["profile-portfolio-count", fundSlug],
    enabled: persona === "fund" && !!fundSlug,
    queryFn: async () => {
      const { count } = await supabase
        .from("fund_portfolio")
        .select("company_slug", { count: "exact", head: true })
        .eq("fund_slug", fundSlug!);
      return count ?? 0;
    },
  });

  return (
    <div className="max-w-[1100px] space-y-6">
      <header>
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Profile</div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          {persona === "fund" ? "Your fund" : "Your firm + ICP"}
        </h1>
        <p className="text-[12.5px] text-muted-foreground mt-1.5 max-w-[640px]">
          {persona === "fund"
            ? "Pick the fund you work at. Your dashboard auto-populates with that fund's portfolio."
            : "Define your firm and your Ideal Customer Profile. The dashboard target stream is filtered and ranked from this."}
        </p>
      </header>

      {/* Persona toggle */}
      <section className="as-card p-4 space-y-2.5">
        <div className="text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">Who are you?</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <PersonaTile active={persona === "security"} onClick={() => setPersona("security")} icon={<ShieldCheck className="w-4 h-4" />} label="Security firm" hint="Audit firm, security vendor, monitoring, or researcher" />
          <PersonaTile active={persona === "fund"} onClick={() => setPersona("fund")} icon={<Wallet className="w-4 h-4" />} label="Fund / LP" hint="Track a portfolio of crypto investments" />
        </div>
      </section>

      {persona === "security" && (
        <>
          {/* Website + identity */}
          <section className="as-card p-5 space-y-3.5">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Your firm</h2>
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              Paste your homepage URL — we'll scan it AND pull deep firmographic data (Apollo + Brand + workforce + competitors) so the dashboard knows who you are.
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                value={companyUrl}
                onChange={(e) => setCompanyUrl(e.target.value)}
                placeholder="https://your-firm.com"
                className="flex-1 px-3 py-2 text-[12.5px] bg-white/[0.03] border rounded text-foreground"
                style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}
              />
              <button
                type="button"
                onClick={handleScrape}
                disabled={scrapeMut.isPending || enrichSelfMut.isPending || !companyUrl.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-primary/15 hover:bg-primary/25 text-primary text-[12px] font-semibold disabled:opacity-40"
              >
                {(scrapeMut.isPending || enrichSelfMut.isPending) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Scan & enrich
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1.5">
              <Field label="Firm name">
                <input type="text" value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="Trail of Bits, Cyfrin…" className="w-full px-3 py-2 text-[12.5px] bg-white/[0.03] border rounded text-foreground" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }} />
              </Field>
              <Field label="What you sell">
                <input type="text" value={sellsWhat} onChange={(e) => setSellsWhat(e.target.value)} placeholder="Smart contract audits, monitoring…" className="w-full px-3 py-2 text-[12.5px] bg-white/[0.03] border rounded text-foreground" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }} />
              </Field>
            </div>

            {companyDescription && (
              <Field label="Description (auto-pulled, editable)">
                <textarea value={companyDescription} onChange={(e) => setCompanyDescription(e.target.value)} rows={3} className="w-full px-3 py-2 text-[12px] bg-white/[0.03] border rounded text-foreground resize-y" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }} />
              </Field>
            )}
          </section>

          {/* Targeting — only the 3 fields that directly drive the dashboard feed */}
          <section className="as-card p-5 space-y-3.5">
            <div className="flex items-center gap-2">
              <TargetIcon className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Targeting</h2>
              <span className="text-[10px] text-muted-foreground ml-1">tunes your dashboard target stream</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Focus sectors">
                <SearchableSelect
                  multi
                  values={focusCategories}
                  onMultiChange={setFocusCategories}
                  options={allCategoriesQ.data ?? []}
                  loading={allCategoriesQ.isLoading}
                  placeholder="All sectors"
                />
              </Field>
              <Field label="Chains / languages">
                <SearchableSelect
                  multi
                  values={targetChains}
                  onMultiChange={setTargetChains}
                  options={chainOptions}
                  placeholder="All chains"
                />
              </Field>
              <Field label="Min total raised (USD)">
                <input type="number" inputMode="decimal" value={minRaisedUsd} onChange={(e) => setMinRaisedUsd(e.target.value)} placeholder="e.g. 5000000" className="w-full px-3 py-2 text-[12.5px] bg-white/[0.03] border rounded text-foreground tabular-nums" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }} />
              </Field>
            </div>

            <label className="inline-flex items-center gap-2 text-[12px] text-foreground cursor-pointer">
              <input type="checkbox" checked={hideExisting} onChange={(e) => setHideExisting(e.target.checked)} className="w-4 h-4 accent-primary" />
              Hide protocols I already audit
            </label>
          </section>
        </>
      )}

      {/* FUND PERSONA */}
      {persona === "fund" && (
        <>
          <section className="as-card p-5 space-y-3.5">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">My fund</h2>
            </div>
            {fundSlug ? (
              <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3.5 flex items-center gap-3">
                <BrandLogo name={fundName || fundSlug} url={fundNameLookupQ.data?.[fundSlug]?.website ?? null} logo={fundNameLookupQ.data?.[fundSlug]?.logo ?? null} className="w-11 h-11 rounded-lg shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-foreground truncate">{fundName ?? fundSlug}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2.5">
                    {portfolioCountQ.data != null && <span>{portfolioCountQ.data.toLocaleString()} portfolio cos.</span>}
                    {fundNameLookupQ.data?.[fundSlug]?.website && (
                      <a href={fundNameLookupQ.data[fundSlug]!.website!} target="_blank" rel="noreferrer" className="text-primary/80 hover:text-primary inline-flex items-center gap-1">
                        {fundNameLookupQ.data[fundSlug]!.website!.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => { setFundSlug(null); setFundName(null); }} className="text-[11px] text-muted-foreground hover:text-rose-300 inline-flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> change
                </button>
              </div>
            ) : (
              <AsyncAutocomplete fetcher={fundSearch} onSelect={(opt) => { setFundSlug(opt.value); setFundName(typeof opt.label === "string" ? opt.label.split(" · ")[0] : null); }} placeholder="Search for your fund — type at least 2 characters" />
            )}
            {fundSlug && portfolioPreviewQ.data && portfolioPreviewQ.data.length > 0 && (
              <div className="mt-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Recent positions</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {portfolioPreviewQ.data.map((p) => (
                    <Link key={p.company_slug} to={`/protocol/${p.company_slug}`} className="rounded-md border border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.03] px-2.5 py-1.5 flex items-center gap-2 text-[12px]">
                      <span className="text-foreground truncate flex-1">{p.company_name || p.company_slug}</span>
                      {p.round_type && <span className="text-[10px] text-muted-foreground">{p.round_type}</span>}
                      {p.round_date && <span className="text-[10px] text-muted-foreground tabular-nums">{p.round_date}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="as-card p-5 space-y-3.5">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Funds you're watching</h2>
              <span className="text-[10px] text-muted-foreground ml-1">optional</span>
            </div>
            {watchedFundSlugs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {watchedFundSlugs.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] pl-2 pr-1 py-0.5 text-[11.5px]">
                    {watchedFundNames[s] || s}
                    <button type="button" onClick={() => setWatchedFundSlugs(watchedFundSlugs.filter((x) => x !== s))} className="text-muted-foreground hover:text-rose-300">×</button>
                  </span>
                ))}
              </div>
            )}
            <AsyncAutocomplete fetcher={fundSearch} onSelect={(opt) => {
              if (!watchedFundSlugs.includes(opt.value)) {
                setWatchedFundSlugs([...watchedFundSlugs, opt.value]);
                const nameOnly = typeof opt.label === "string" ? opt.label.split(" · ")[0] : opt.value;
                setWatchedFundNames((m) => ({ ...m, [opt.value]: nameOnly }));
              }
            }} placeholder="Add a fund to watch" />
          </section>
        </>
      )}

      {/* Notifications */}
      <section className="as-card p-5 space-y-3.5">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Alerts</h2>
          <span className="text-[10px] text-muted-foreground ml-1">push for new audits, funding, hacks, news on watched companies</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
          {([
            { v: "slack", l: "Slack", i: <Slack className="w-3.5 h-3.5" /> },
            { v: "telegram", l: "Telegram", i: <Send className="w-3.5 h-3.5" /> },
            { v: "both", l: "Both", i: <Bell className="w-3.5 h-3.5" /> },
            { v: "none", l: "Off", i: null },
          ] as const).map((opt) => (
            <button key={opt.v} type="button" onClick={() => setNotifChannel(opt.v)} className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[12px] font-medium transition-colors ${notifChannel === opt.v ? "border-primary/40 bg-primary/[0.10] text-primary" : "border-white/[0.06] text-muted-foreground hover:text-foreground"}`}>
              {opt.i}{opt.l}
            </button>
          ))}
        </div>
        {(notifChannel === "slack" || notifChannel === "both") && (
          <Field label="Slack incoming webhook (channel-specific)">
            <input type="url" value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} placeholder="https://hooks.slack.com/services/T…/B…/…" className="w-full px-3 py-2 text-[12.5px] bg-white/[0.03] border rounded text-foreground font-mono" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }} />
            <p className="text-[10.5px] text-muted-foreground mt-1">Create at <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer" className="text-primary hover:underline">api.slack.com/messaging/webhooks</a></p>
          </Field>
        )}
        {(notifChannel === "telegram" || notifChannel === "both") && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-2">
              <Field label="Telegram bot token">
                <input type="text" value={tgToken} onChange={(e) => setTgToken(e.target.value)} placeholder="123456:ABC-DEF…" className="w-full px-3 py-2 text-[12.5px] bg-white/[0.03] border rounded text-foreground font-mono" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }} />
              </Field>
            </div>
            <Field label="Chat ID">
              <input type="text" value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} placeholder="-100…" className="w-full px-3 py-2 text-[12.5px] bg-white/[0.03] border rounded text-foreground font-mono" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }} />
            </Field>
          </div>
        )}
        {notifChannel !== "none" && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-300" />
              Watchlist sweeps every 5 min and pings this channel when something matters.
            </div>
            <button type="button" onClick={testNotif} disabled={testingNotif} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/[0.08] text-[11.5px] font-medium hover:bg-white/[0.04] disabled:opacity-40">
              {testingNotif ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Send test
            </button>
          </div>
        )}
      </section>

      <div className="flex items-center justify-end gap-3 sticky bottom-3">
        <button type="button" disabled={saveMut.isPending} onClick={() => saveMut.mutate()} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-50">
          <Save className="w-3.5 h-3.5" />
          {saveMut.isPending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}

function PersonaTile({ active, onClick, icon, label, hint }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <button type="button" onClick={onClick} className={`text-left rounded-md border px-3 py-3 transition-colors ${active ? "border-primary/50 bg-primary/[0.08]" : "border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.03]"}`}>
      <div className={`flex items-center gap-2 mb-1 ${active ? "text-primary" : "text-foreground"}`}>
        {icon}<span className="text-sm font-semibold">{label}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground block">{label}</label>
      {children}
    </div>
  );
}

