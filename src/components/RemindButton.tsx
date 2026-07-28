import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, ChevronDown, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

type Props = {
  companySlug: string;
  companyName: string | null;
  source?: string;
  compact?: boolean;
};

type PresetUnit = "weeks" | "months";
type Preset = { label: string; n: number; unit: PresetUnit };

const PRESETS: Preset[] = [
  { label: "In 2 weeks", n: 2, unit: "weeks" },
  { label: "In 1 month", n: 1, unit: "months" },
  { label: "In 3 months", n: 3, unit: "months" },
  { label: "In 6 months", n: 6, unit: "months" },
  { label: "In 12 months", n: 12, unit: "months" },
];

function toIso(p: Preset): string {
  const d = new Date();
  if (p.unit === "weeks") d.setDate(d.getDate() + p.n * 7);
  else d.setMonth(d.getMonth() + p.n);
  return d.toISOString();
}

export function RemindButton({ companySlug, companyName, source, compact = false }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function create(remind_at: string, label: string) {
    if (!user) {
      toast.error("Sign in to set reminders.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("reminders").insert({
        user_id: user.id,
        company_slug: companySlug,
        company_name: companyName,
        remind_at,
        source: source || null,
        note: null,
      });
      if (error) throw error;
      toast.success(`Reminder set ${label} for ${companyName || companySlug}`);
      setOpen(false);
      setCustomDate("");
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["reminders-due-count"] });
    } catch (e) {
      console.error("[reminder insert]", e);
      const o = e as { message?: string; code?: string } | null;
      const msg = e instanceof Error ? e.message : o?.message || JSON.stringify(e);
      toast.error(`Reminder failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  const btnCls = compact
    ? "text-[11px] px-2 py-1 inline-flex items-center gap-1 rounded-md text-muted-foreground hover:text-primary border border-white/10 hover:border-white/20 bg-white/[0.03]"
    : "text-xs px-2.5 py-1.5 inline-flex items-center gap-1.5 rounded-md text-muted-foreground hover:text-primary border border-white/10 hover:border-white/20 bg-white/[0.03]";

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={btnCls}
        title="Set a reminder to follow up"
      >
        {savedFlash ? (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-emerald-400">Set</span>
          </>
        ) : (
          <>
            {open ? <BellRing className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
            <span>Remind</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </>
        )}
      </button>
      {open && (
        <div className="absolute z-30 right-0 mt-1 w-56 rounded-md border border-white/10 bg-surface shadow-xl py-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={saving}
              onClick={() => create(toIso(p), p.label.toLowerCase())}
              className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-white/[0.05] disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
          <div className="px-3 pt-2 pb-1 border-t border-white/[0.06] mt-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Custom date
            </div>
            <div className="flex gap-1">
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="flex-1 text-xs bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-white outline-none focus:border-primary"
              />
              <button
                type="button"
                disabled={!customDate || saving}
                onClick={() => {
                  const iso = new Date(`${customDate}T09:00:00`).toISOString();
                  create(iso, `on ${customDate}`);
                }}
                className="text-xs px-2 py-1 rounded bg-primary/15 text-primary disabled:opacity-40"
              >
                Set
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
