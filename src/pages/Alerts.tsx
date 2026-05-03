import { useState, FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase, type UserAlert } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

const TRIGGERS = [
  { id: "tvl_spike", label: "TVL Spike" },
  { id: "stale_audit", label: "Stale Audit" },
  { id: "new_hack", label: "New Hack" },
  { id: "no_bug_bounty", label: "No Bug Bounty" },
];

export default function Alerts() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const alerts = useQuery({
    queryKey: ["user-alerts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_alerts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as UserAlert[];
    },
    enabled: !!user,
  });

  const [name, setName] = useState("");
  const [minTvl, setMinTvl] = useState("500000");
  const [score, setScore] = useState(60);
  const [triggers, setTriggers] = useState<string[]>([]);
  const [slack, setSlack] = useState("");
  const [telegram, setTelegram] = useState("");
  const [saving, setSaving] = useState(false);

  function toggleTrigger(id: string) {
    setTriggers((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!name.trim()) return toast.error("Name your alert");
    if (triggers.length === 0) return toast.error("Pick at least one trigger");
    setSaving(true);
    const { error } = await supabase.from("user_alerts").insert({
      user_id: user.id,
      alert_name: name.trim(),
      min_tvl: Number(minTvl) || 0,
      score_threshold: score,
      trigger_types: triggers,
      slack_webhook: slack || null,
      telegram_chat_id: telegram || null,
      is_active: true,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Alert created");
    setName(""); setTriggers([]); setSlack(""); setTelegram("");
    qc.invalidateQueries({ queryKey: ["user-alerts"] });
  }

  async function toggleActive(a: UserAlert) {
    const { error } = await supabase.from("user_alerts").update({ is_active: !a.is_active }).eq("id", a.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["user-alerts"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("user_alerts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Alert removed");
    qc.invalidateQueries({ queryKey: ["user-alerts"] });
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="as-card p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Your Alerts</h3>
        {alerts.isLoading ? (
          <div className="h-20 bg-white/[0.03] rounded animate-pulse" />
        ) : alerts.data && alerts.data.length > 0 ? (
          <div className="divide-y divide-white/[0.05]">
            {alerts.data.map((a) => (
              <div key={a.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">{a.alert_name || "Untitled"}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {a.trigger_types?.join(" • ") || "no triggers"}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={a.is_active} onChange={() => toggleActive(a)} className="accent-primary" />
                    <span className="text-xs text-muted-foreground">{a.is_active ? "Active" : "Off"}</span>
                  </label>
                  <button onClick={() => remove(a.id)} className="text-muted-foreground hover:text-destructive p-1.5 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No alerts configured yet.</p>
        )}
      </div>

      <form onSubmit={onSave} className="as-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Create New Alert</h3>

        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Alert name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="High-TVL unaudited watch" className="as-input mt-1" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Min TVL ($)</label>
            <input type="number" value={minTvl} onChange={(e) => setMinTvl(e.target.value)} className="as-input mt-1" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Risk score threshold: <span className="font-mono text-primary">{score}</span>
            </label>
            <input type="range" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} className="w-full mt-3 accent-primary" />
          </div>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Trigger on</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
            {TRIGGERS.map((t) => (
              <label key={t.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm ${triggers.includes(t.id) ? "border-primary bg-primary/10 text-primary" : "border-white/[0.08] bg-input text-muted-foreground"}`}>
                <input type="checkbox" checked={triggers.includes(t.id)} onChange={() => toggleTrigger(t.id)} className="accent-primary" />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Slack webhook URL</label>
            <input value={slack} onChange={(e) => setSlack(e.target.value)} placeholder="https://hooks.slack.com/…" className="as-input mt-1" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Telegram chat ID</label>
            <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="-100…" className="as-input mt-1" />
          </div>
        </div>

        <button type="submit" disabled={saving} className="as-btn as-btn-primary disabled:opacity-60">
          {saving ? "Saving…" : "Save alert"}
        </button>
      </form>
    </div>
  );
}
