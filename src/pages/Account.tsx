import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { KeyRound, Plus, Copy, Trash2, Crown, Zap, Building2, ArrowRight, Bell, Slack, Send, Loader2, Save, Activity } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

type PlanTier = "free" | "developer" | "pro" | "enterprise";

const PLAN_INFO: Record<PlanTier, { label: string; color: string; rate: string; keys: number }> = {
  free:        { label: "Free",        color: "text-muted-foreground", rate: "60 req/min",   keys: 1 },
  developer:   { label: "Developer",   color: "text-sky-300",          rate: "240 req/min",  keys: 3 },
  pro:         { label: "Pro",         color: "text-primary",          rate: "1,200 req/min",keys: 10 },
  enterprise:  { label: "Enterprise",  color: "text-emerald-300",      rate: "6,000 req/min",keys: 25 },
};

export default function Account() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const profileQ = useQuery({
    queryKey: ["account-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("plan_tier,notification_channel,slack_webhook_url,telegram_bot_token,telegram_chat_id,trial_ends_at")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const tier: PlanTier = (profileQ.data?.plan_tier ?? "free") as PlanTier;
  const plan = PLAN_INFO[tier];

  const keysQ = useQuery({
    queryKey: ["account-keys", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("api_keys")
        .select("id,name,key_prefix,rate_limit_per_min,last_used_at,created_at,revoked_at,tier")
        .eq("user_id", user!.id)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const usageQ = useQuery({
    queryKey: ["account-usage", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { count } = await supabase
        .from("api_usage")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .gte("created_at", since);
      return count ?? 0;
    },
  });

  const createKeyMut = useMutation({
    mutationFn: async (name: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("https://qktjbtmcjrwzmtqnszbq.supabase.co/functions/v1/create-api-key", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j as { key: string; key_prefix: string; name: string };
    },
    onSuccess: (data) => {
      setRevealedKey(data.key);
      setNewKeyName("");
      qc.refetchQueries({ queryKey: ["account-keys", user?.id] });
      toast.success("API key created. Copy it now — you won't see it again.");
    },
    onError: (e: any) => toast.error(e?.message || "Key creation failed"),
  });

  const revokeMut = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await supabase
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", keyId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Key revoked");
      qc.refetchQueries({ queryKey: ["account-keys", user?.id] });
    },
    onError: (e: any) => toast.error(e?.message || "Revoke failed"),
  });

  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copied"); };

  return (
    <div className="max-w-[1100px] mx-auto space-y-6">
      <header>
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">My Profile</div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">Profile, API &amp; alerts</h1>
      </header>

      {/* Plan tier */}
      <section className="as-card p-5 space-y-4">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[280px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current plan</div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-2xl font-semibold ${plan.color}`}>{plan.label}</span>
              {tier === "pro" && <Crown className="w-4 h-4 text-primary" />}
              {tier === "enterprise" && <Building2 className="w-4 h-4 text-emerald-300" />}
            </div>
            <div className="text-[12px] text-muted-foreground mt-1.5">
              {plan.rate} · up to {plan.keys} active API key{plan.keys === 1 ? "" : "s"}
            </div>
          </div>
          <div>
            {tier === "free" ? (
              <Link to="/pricing" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-[12.5px] font-semibold hover:bg-primary/90">
                Upgrade <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            ) : tier === "enterprise" ? (
              <a href="https://t.me/web3leads" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-white/[0.10] text-[12.5px] font-semibold hover:bg-white/[0.04]">
                Message us on Telegram
              </a>
            ) : (
              <Link to="/pricing" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-white/[0.10] text-[12.5px] font-semibold hover:bg-white/[0.04]">
                Manage plan
              </Link>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
          <StatTile label="API calls last 30d" value={usageQ.data?.toLocaleString() ?? "—"} tone="primary" icon={<Activity className="w-3.5 h-3.5" />} />
          <StatTile label="Active keys" value={`${keysQ.data?.length ?? 0} / ${plan.keys}`} tone="muted" />
          <StatTile label="Watchlist alerts" value={tier === "free" ? "Off" : "On"} tone={tier === "free" ? "muted" : "good"} />
          <StatTile label="Webhooks" value={tier === "pro" || tier === "enterprise" ? "Available" : "Pro+"} tone={tier === "pro" || tier === "enterprise" ? "good" : "muted"} />
        </div>
      </section>

      {/* API keys */}
      <section className="as-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">API keys</h2>
          <span className="text-[10px] text-muted-foreground ml-1">used for the developer API</span>
        </div>

        {/* Trial vs paid — make the limits + upgrade obvious */}
        <div className="rounded-md border border-primary/20 bg-primary/[0.04] p-3.5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-foreground inline-flex items-center gap-1.5">
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 uppercase tracking-wider font-bold">Trial</span>
                New keys stream fresh audits as we catch them
              </div>
              <ul className="text-[11.5px] text-muted-foreground mt-2 space-y-1">
                <li>• Live feed: new audits from the last <span className="text-foreground">180 days</span></li>
                <li>• Up to <span className="text-foreground">25 rows</span> per request</li>
                <li>• Report URLs &amp; the full 21K+ archive are <span className="text-foreground">withheld</span></li>
              </ul>
            </div>
            <div className="text-right shrink-0">
              <Link to="/pricing" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90">
                Upgrade — full data <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <div className="text-[10px] text-muted-foreground mt-1.5">Full history · report links · higher limits</div>
            </div>
          </div>
        </div>

        {revealedKey && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-amber-200/90 font-semibold">⚠️ Save this key now — you won't see it again</div>
            <div className="flex items-center gap-2">
              <input readOnly value={revealedKey} className="flex-1 px-3 py-2 text-[12px] font-mono bg-black/30 border border-amber-500/30 rounded text-foreground" />
              <button onClick={() => copy(revealedKey)} className="px-3 py-2 rounded bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 text-[12px] font-semibold inline-flex items-center gap-1.5">
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
              <button onClick={() => setRevealedKey(null)} className="px-3 py-2 rounded border border-white/[0.10] text-[12px] hover:bg-white/[0.04]">
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g. production, staging)"
            className="flex-1 px-3 py-2 text-[12.5px] bg-white/[0.03] border rounded text-foreground"
            style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}
          />
          <button
            onClick={() => createKeyMut.mutate(newKeyName.trim() || "default")}
            disabled={createKeyMut.isPending}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-[12.5px] font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {createKeyMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Generate key
          </button>
        </div>

        {keysQ.isLoading ? (
          <div className="text-[12px] text-muted-foreground">Loading…</div>
        ) : (keysQ.data ?? []).length === 0 ? (
          <div className="text-[12px] text-muted-foreground text-center py-6 border border-dashed rounded-md" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
            No API keys yet. Generate one to start hitting the API.
          </div>
        ) : (
          <div className="space-y-2">
            {(keysQ.data ?? []).map((k: any) => (
              <div key={k.id} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-foreground inline-flex items-center gap-2">
                    {k.name}
                    <span className="text-[10px] text-muted-foreground font-mono">{k.key_prefix}…</span>
                    {(k.tier ?? "trial") === "trial" ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 uppercase tracking-wider font-bold">Trial</span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 uppercase tracking-wider font-bold">Full</span>
                    )}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground mt-0.5">
                    {k.rate_limit_per_min} req/min · created {new Date(k.created_at).toLocaleDateString()}
                    {k.last_used_at && ` · last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                  </div>
                </div>
                <button
                  onClick={() => { if (confirm(`Revoke key "${k.name}"? This breaks any client using it.`)) revokeMut.mutate(k.id); }}
                  className="text-[11px] text-muted-foreground hover:text-rose-300 inline-flex items-center gap-1 px-2 py-1.5 rounded hover:bg-white/[0.03]"
                >
                  <Trash2 className="w-3 h-3" /> Revoke
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="text-[11px] text-muted-foreground pt-2 border-t" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
          Use your key in the <code className="text-primary font-mono">X-Api-Key</code> header. Read the <Link to="/docs" className="text-primary hover:underline">API docs</Link> for endpoints.
        </div>
      </section>

      {/* Notification channels */}
      <NotificationCard tier={tier} profile={profileQ.data} />
    </div>
  );
}

function StatTile({ label, value, tone, icon }: { label: string; value: string; tone: "primary"|"muted"|"good"; icon?: React.ReactNode }) {
  const t = tone === "primary" ? "text-primary" : tone === "good" ? "text-emerald-300" : "text-foreground";
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">{icon}{label}</div>
      <div className={`text-lg font-semibold tabular-nums mt-0.5 ${t}`}>{value}</div>
    </div>
  );
}

function NotificationCard({ tier, profile }: { tier: PlanTier; profile: any }) {
  const isFree = tier === "free";
  const [channel, setChannel] = useState<string>(profile?.notification_channel ?? (profile?.slack_webhook_url ? "slack" : "none"));
  const [slackUrl, setSlackUrl] = useState(profile?.slack_webhook_url ?? "");
  const [tgToken, setTgToken] = useState(profile?.telegram_bot_token ?? "");
  const [tgChatId, setTgChatId] = useState(profile?.telegram_chat_id ?? "");
  const { user } = useAuth();
  const qc = useQueryClient();

  const saveMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("user_profiles").upsert({
        user_id: user!.id,
        notification_channel: channel,
        slack_webhook_url: slackUrl.trim() || null,
        telegram_bot_token: tgToken.trim() || null,
        telegram_chat_id: tgChatId.trim() || null,
      }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Saved"); qc.refetchQueries({ queryKey: ["account-profile", user?.id] }); },
    onError: (e: any) => toast.error(e?.message || "Save failed"),
  });

  if (isFree) {
    return (
      <section className="as-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Alerts</h2>
        </div>
        <div className="rounded-md border border-primary/25 bg-primary/[0.04] p-4 text-center space-y-3">
          <Zap className="w-6 h-6 text-primary mx-auto" />
          <div className="text-[14px] font-semibold text-foreground">Watchlist alerts are a Developer feature</div>
          <p className="text-[12.5px] text-muted-foreground max-w-[420px] mx-auto">
            Pipe new audits, hacks, funding rounds, and news for your watched protocols directly to Telegram. Slack coming soon.
          </p>
          <Link to="/pricing" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-[12.5px] font-semibold hover:bg-primary/90">
            Unlock everything — $59/mo <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="as-card p-5 space-y-3.5">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Alerts</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        {([
          { v: "slack", l: "Slack", i: <Slack className="w-3.5 h-3.5" />, disabled: true, soon: true },
          { v: "telegram", l: "Telegram", i: <Send className="w-3.5 h-3.5" /> },
          { v: "both", l: "Both", i: <Bell className="w-3.5 h-3.5" />, disabled: true, soon: true },
          { v: "none", l: "Off", i: null },
        ] as const).map((opt) => (
          <button
            key={opt.v}
            disabled={(opt as any).disabled}
            type="button"
            onClick={() => setChannel(opt.v)}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[12px] font-medium transition-colors ${
              channel === opt.v ? "border-primary/40 bg-primary/[0.10] text-primary" : "border-white/[0.06] text-muted-foreground hover:text-foreground"
            } ${(opt as any).disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {opt.i}{opt.l}
            {(opt as any).soon
              ? <span className="text-[9px] text-amber-300 ml-1">Soon</span>
              : (opt as any).disabled && <span className="text-[9px] text-amber-300 ml-1">Pro</span>}
          </button>
        ))}
      </div>

      {(channel === "slack" || channel === "both") && (
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Slack webhook</label>
          <input type="url" value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} placeholder="https://hooks.slack.com/services/..." className="w-full px-3 py-2 text-[12.5px] bg-white/[0.03] border rounded text-foreground font-mono" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }} />
        </div>
      )}
      {(channel === "telegram" || channel === "both") && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="md:col-span-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Telegram bot token</label>
            <input type="text" value={tgToken} onChange={(e) => setTgToken(e.target.value)} placeholder="123456:ABC-DEF…" className="w-full px-3 py-2 text-[12.5px] bg-white/[0.03] border rounded text-foreground font-mono" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Chat ID</label>
            <input type="text" value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} placeholder="-100…" className="w-full px-3 py-2 text-[12.5px] bg-white/[0.03] border rounded text-foreground font-mono" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }} />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-50">
          <Save className="w-3.5 h-3.5" />
          {saveMut.isPending ? "Saving…" : "Save alerts"}
        </button>
      </div>
    </section>
  );
}
