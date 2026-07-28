import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/Logo";

type Mode = "fund" | "security" | null;

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(null);
  const [fundQuery, setFundQuery] = useState("");
  const [fundSlug, setFundSlug] = useState<string | null>(null);
  const [fundName, setFundName] = useState<string>("");
  const [firmName, setFirmName] = useState("");
  const [firmWebsite, setFirmWebsite] = useState("");
  const [scrapeStatus, setScrapeStatus] = useState<"idle" | "scraping" | "done" | "fail">("idle");
  const [scrapeResult, setScrapeResult] = useState<{ tags: string[]; what_they_sell: string | null; summary: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // If profile already set up, skip onboarding
  const profileQ = useQuery({
    queryKey: ["onboarding-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("fund_slug,firm_type,company_name")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (profileQ.data && (profileQ.data.fund_slug || profileQ.data.firm_type)) {
      navigate("/dashboard", { replace: true });
    }
  }, [profileQ.data, navigate]);

  const fundsQ = useQuery({
    queryKey: ["onboarding-funds", fundQuery],
    enabled: mode === "fund" && fundQuery.length >= 2,
    queryFn: async () => {
      const { data } = await supabase
        .from("funds")
        .select("slug,name,investment_count")
        .ilike("name", `%${fundQuery}%`)
        .order("investment_count", { ascending: false, nullsFirst: false })
        .limit(10);
      return (data ?? []) as Array<{ slug: string; name: string; investment_count: number | null }>;
    },
  });

  const canSubmit = useMemo(() => {
    if (!mode) return false;
    if (mode === "fund") return !!fundSlug;
    return firmName.trim().length > 1;
  }, [mode, fundSlug, firmName]);

  const runScrape = async () => {
    if (firmWebsite.trim().length < 4) return;
    setScrapeStatus("scraping");
    try {
      const { data: session } = await supabase.auth.getSession();
      const r = await fetch("https://qktjbtmcjrwzmtqnszbq.supabase.co/functions/v1/scrape-vendor-site", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ url: firmWebsite.trim() }),
      });
      if (!r.ok) throw new Error(`scrape ${r.status}`);
      const j = await r.json();
      setScrapeResult({
        tags: Array.isArray(j.tags) ? j.tags : [],
        what_they_sell: j.what_they_sell ?? null,
        summary: j.summary ?? "",
      });
      if (j.firm_name_guess && firmName.trim().length === 0) setFirmName(j.firm_name_guess);
      setScrapeStatus("done");
    } catch (e) {
      console.error(e);
      setScrapeStatus("fail");
    }
  };

  const onSubmit = async () => {
    if (!user || !canSubmit) return;
    setSaving(true);
    try {
      const profileRow: Record<string, any> = {
        user_id: user.id,
        role: "fund",
        updated_at: new Date().toISOString(),
      };
      if (mode === "fund") {
        profileRow.fund_slug = fundSlug;
        profileRow.firm_type = "investor";
      } else if (mode === "security") {
        profileRow.firm_type = "security_firm";
        profileRow.company_name = firmName.trim();
        if (firmWebsite.trim()) profileRow.company_website = firmWebsite.trim();
        if (scrapeResult?.what_they_sell) profileRow.sells_what = scrapeResult.what_they_sell;
        if (scrapeResult?.tags && scrapeResult.tags.length > 0) profileRow.specialties = scrapeResult.tags;
      }
      const { error } = await supabase.from("user_profiles").upsert(profileRow, { onConflict: "user_id" });
      if (error) throw error;

      toast.success("All set.");
      navigate("/dashboard", { replace: true });
    } catch (e: any) {
      toast.error(e.message || "Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-6">
        <Logo size={40} />
      </div>
      <div className="as-card w-full max-w-xl p-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Welcome to AuditScope</h1>
          <p className="text-sm text-muted-foreground mt-1">
            One quick question and we'll set up your dashboard.
          </p>
        </div>

        {/* Step 1: Mode */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">Who are you?</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ModeCard
              active={mode === "fund"}
              onClick={() => setMode("fund")}
              icon={<Wallet className="w-4 h-4" />}
              label="Fund / LP"
              hint="Track a portfolio of crypto investments"
            />
            <ModeCard
              active={mode === "security"}
              onClick={() => setMode("security")}
              icon={<ShieldCheck className="w-4 h-4" />}
              label="Security firm"
              hint="Audit firm, security vendor, or researcher"
            />
          </div>
        </div>

        {/* Step 2 (fund): pick the fund */}
        {mode === "fund" && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">Which fund?</div>
            {fundSlug ? (
              <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/10 px-3 py-2.5">
                <span className="text-sm text-white">{fundName || fundSlug}</span>
                <button
                  onClick={() => { setFundSlug(null); setFundName(""); setFundQuery(""); }}
                  className="text-xs text-muted-foreground hover:text-white"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  value={fundQuery}
                  onChange={(e) => setFundQuery(e.target.value)}
                  placeholder="Search 5,200+ funds by name…"
                  className="as-input text-sm"
                  autoFocus
                />
                {fundsQ.data && fundsQ.data.length > 0 && (
                  <div className="rounded-md border border-white/[0.08] divide-y divide-white/[0.04] max-h-[260px] overflow-y-auto">
                    {fundsQ.data.map((f) => (
                      <button
                        key={f.slug}
                        type="button"
                        onClick={() => { setFundSlug(f.slug); setFundName(f.name); }}
                        className="w-full px-3 py-2 text-left hover:bg-white/[0.04] flex items-center justify-between"
                      >
                        <span className="text-sm text-white">{f.name}</span>
                        {f.investment_count != null && (
                          <span className="text-[11px] text-muted-foreground">{f.investment_count} deals</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {fundQuery.length >= 2 && fundsQ.data && fundsQ.data.length === 0 && (
                  <div className="text-xs text-muted-foreground italic">No matches. Try a shorter query.</div>
                )}
              </>
            )}
          </div>
        )}

        {/* Step 2 (security): website + firm name */}
        {mode === "security" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">Your firm's website</div>
              <div className="flex gap-2">
                <input
                  value={firmWebsite}
                  onChange={(e) => setFirmWebsite(e.target.value)}
                  onBlur={() => { if (firmWebsite.trim().length >= 4 && scrapeStatus === "idle") runScrape(); }}
                  placeholder="https://trailofbits.com"
                  className="as-input text-sm"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={runScrape}
                  disabled={firmWebsite.trim().length < 4 || scrapeStatus === "scraping"}
                  className="text-[11px] px-3 py-2 rounded-md border border-primary/30 text-primary disabled:opacity-50 hover:bg-primary/[0.06] whitespace-nowrap"
                >
                  {scrapeStatus === "scraping" ? "Reading…" : "Analyze site"}
                </button>
              </div>
              <p className="text-[10.5px] text-muted-foreground">
                We'll read your site and figure out what you sell. Skip if you'd rather type it yourself.
              </p>
            </div>

            {scrapeResult && scrapeStatus === "done" && (
              <div className="rounded-md border border-primary/20 bg-primary/[0.04] p-2.5 space-y-1.5 text-[11.5px]">
                <div className="flex items-center gap-1.5 text-primary font-semibold">✓ Got it</div>
                {scrapeResult.what_they_sell && (
                  <div className="text-white">You sell: <span className="font-semibold">{scrapeResult.what_they_sell}</span></div>
                )}
                {scrapeResult.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {scrapeResult.tags.map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-primary/30 text-primary">{t}</span>
                    ))}
                  </div>
                )}
                {scrapeResult.summary && <div className="text-muted-foreground line-clamp-3">{scrapeResult.summary}</div>}
              </div>
            )}
            {scrapeStatus === "fail" && (
              <div className="text-[11px] text-amber-300">Couldn't read that site. No problem — just type your firm name below.</div>
            )}

            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">Firm name</div>
              <input
                value={firmName}
                onChange={(e) => setFirmName(e.target.value)}
                placeholder="Trail of Bits, Cyfrin, Halborn, Tenderly…"
                className="as-input text-sm"
              />
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => navigate("/dashboard", { replace: true })}
            className="text-xs text-muted-foreground hover:text-white"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit || saving}
            className="text-sm px-4 py-2 rounded-md bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:opacity-40 inline-flex items-center gap-2"
          >
            {saving ? "Saving…" : <>Continue <ArrowRight className="w-3.5 h-3.5" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeCard({ active, onClick, icon, label, hint }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-md border px-3 py-3 transition-colors ${
        active ? "border-primary/50 bg-primary/[0.08]" : "border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.03]"
      }`}
    >
      <div className={`flex items-center gap-2 mb-1 ${active ? "text-primary" : "text-white"}`}>
        {icon}
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </button>
  );
}
