import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Target,
  Bell,
  Clock,
  Mail,
  ExternalLink,
  Loader2,
  Check,
  X,
  Flame,
  ShieldCheck,
  Banknote,
  Sparkles,
  EyeOff,
  ClipboardCopy,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { CompanyLogo } from "@/components/CompanyLogo";
import { callAnthropic } from "@/lib/anthropic";
import type { Signal, SignalType } from "@/lib/signals";

type Props = {
  signal: Signal;
  isSaved: boolean;
  isSnoozed: boolean;
  onSelect: (slug: string) => void;
  onSnooze: (id: string) => void;
};

const TYPE_STYLES: Record<SignalType, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  reminder_due: { color: "text-amber-300", bg: "bg-amber-500/10 border-amber-500/30", label: "Reminder due", icon: <Bell className="w-3 h-3" /> },
  recent_audit: { color: "text-cyan-300", bg: "bg-cyan-500/10 border-cyan-500/30", label: "Recent audit", icon: <ShieldCheck className="w-3 h-3" /> },
  stale_audit: { color: "text-red-300", bg: "bg-red-500/10 border-red-500/30", label: "Stale audit", icon: <Clock className="w-3 h-3" /> },
  never_audited: { color: "text-red-300", bg: "bg-red-500/10 border-red-500/30", label: "Never audited", icon: <Flame className="w-3 h-3" /> },
  recent_funding: { color: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/30", label: "Funded", icon: <Banknote className="w-3 h-3" /> },
  warm_lead: { color: "text-violet-300", bg: "bg-violet-500/10 border-violet-500/30", label: "Warm", icon: <Sparkles className="w-3 h-3" /> },
};

export function SignalCard({ signal, isSaved, isSnoozed, onSelect, onSnooze }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [savingTarget, setSavingTarget] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [draftCopied, setDraftCopied] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);

  const style = TYPE_STYLES[signal.type];

  async function toggleSave() {
    if (!user) {
      toast.error("Sign in to save targets.");
      return;
    }
    setSavingTarget(true);
    try {
      if (isSaved) {
        const { error } = await supabase
          .from("saved_targets")
          .delete()
          .eq("user_id", user.id)
          .eq("company_slug", signal.company_slug);
        if (error) throw error;
        toast.success(`Removed ${signal.company_name}`);
      } else {
        const { error } = await supabase.from("saved_targets").insert({
          user_id: user.id,
          company_slug: signal.company_slug,
          company_name: signal.company_name,
          company_logo: signal.company_logo,
        });
        if (error) throw error;
        toast.success(`Saved ${signal.company_name}`);
      }
      qc.invalidateQueries({ queryKey: ["today-feed-saved"] });
      qc.invalidateQueries({ queryKey: ["saved-target-slugs"] });
      qc.invalidateQueries({ queryKey: ["saved-targets"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      toast.error(`Save failed: ${msg}`);
    } finally {
      setSavingTarget(false);
    }
  }

  async function setReminder(days: number, label: string) {
    if (!user) {
      toast.error("Sign in to set reminders.");
      return;
    }
    try {
      const remind_at = new Date();
      remind_at.setDate(remind_at.getDate() + days);
      const { error } = await supabase.from("reminders").insert({
        user_id: user.id,
        company_slug: signal.company_slug,
        company_name: signal.company_name,
        remind_at: remind_at.toISOString(),
        source: `today_feed:${signal.type}`,
      });
      if (error) throw error;
      toast.success(`Reminder set ${label} for ${signal.company_name}`);
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["reminders-due-count"] });
      qc.invalidateQueries({ queryKey: ["today-feed-reminders"] });
      setRemindOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      toast.error(`Reminder failed: ${msg}`);
    }
  }

  async function dismissReminder() {
    if (signal.type !== "reminder_due") return;
    const reminderId = signal.id.replace(/^reminder:/, "");
    try {
      const { error } = await supabase.from("reminders").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", reminderId);
      if (error) throw error;
      toast.success("Marked done");
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["reminders-due-count"] });
      qc.invalidateQueries({ queryKey: ["today-feed-reminders"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      toast.error(`Update failed: ${msg}`);
    }
  }

  async function draftOutreach() {
    setDraftLoading(true);
    setDraftError(null);
    setDraftText(null);
    try {
      const system =
        "You are a web3 security sales-outreach copy writer. Write short, specific cold-outreach DMs that lead with a real signal. No fluff, no emojis, no 'I hope this finds you well'. 80-100 words. End with a one-line CTA (book a call, share latest audit scope, etc).";
      const user = `Write a cold-outreach DM to ${signal.company_name}.

Why we're reaching out RIGHT NOW: ${signal.reason}
${signal.detail ? `Additional context: ${signal.detail}` : ""}
${signal.audit_firm ? `Their last audit firm: ${signal.audit_firm}` : ""}
${signal.amount_usd ? `Recent raise: $${signal.amount_usd}` : ""}

Our angle: we sell web3 smart-contract security services (audits, reviews, retainer).

Write the DM in plain text, no greeting prefix like "Hi [name]" — just start with the hook. Make it sound like a human wrote it, not an AI. Reference the specific signal.`;

      const text = await callAnthropic({
        system,
        messages: [{ role: "user", content: user }],
        max_tokens: 400,
      });
      setDraftText(text.trim());
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setDraftLoading(false);
    }
  }

  function copyDraft() {
    if (!draftText) return;
    navigator.clipboard.writeText(draftText).then(() => {
      setDraftCopied(true);
      setTimeout(() => setDraftCopied(false), 1800);
    });
  }

  if (isSnoozed) return null;

  return (
    <div
      className="group as-card p-4 flex flex-col gap-3 hover:border-white/20 transition-colors"
      style={{ background: "#0F1420", borderColor: "rgba(255,255,255,0.08)" }}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onSelect(signal.company_slug)}
          aria-label={`Open ${signal.company_name}`}
          className="shrink-0 hover:scale-105 transition-transform"
        >
          <CompanyLogo
            logo={signal.company_logo}
            url={null}
            name={signal.company_name}
            className="w-11 h-11 rounded-lg"
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => onSelect(signal.company_slug)}
              className="text-sm font-semibold text-white hover:text-primary truncate text-left"
            >
              {signal.company_name}
            </button>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-md border inline-flex items-center gap-1 ${style.bg} ${style.color}`}>
              {style.icon} {style.label}
            </span>
            {signal.badges.slice(0, 2).map((b) => (
              <span key={b} className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground border border-white/10">
                {b}
              </span>
            ))}
          </div>
          <div className="text-xs text-muted-foreground mt-1 leading-snug">{signal.reason}</div>
          {signal.detail && (
            <div className="text-[11px] text-muted-foreground/80 mt-0.5">{signal.detail}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground">score</span>
            <span className="text-sm font-mono font-semibold text-white">{Math.round(signal.score)}</span>
          </div>
          {signal.date && (
            <span className="text-[10px] font-mono text-muted-foreground" title={signal.date}>
              {formatDistanceToNow(new Date(signal.date), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {signal.type === "reminder_due" ? (
          <button
            type="button"
            onClick={dismissReminder}
            className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
          >
            <Check className="w-3 h-3" /> Mark done
          </button>
        ) : null}
        <button
          type="button"
          onClick={toggleSave}
          disabled={savingTarget}
          className={`text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border ${
            isSaved
              ? "bg-primary/10 text-primary border-primary/30"
              : "bg-white/[0.03] text-muted-foreground border-white/10 hover:text-primary hover:border-white/20"
          }`}
        >
          {savingTarget ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
          {isSaved ? "Saved" : "Save"}
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setRemindOpen((v) => !v)}
            className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-primary hover:border-white/20"
          >
            <Bell className="w-3 h-3" /> Remind
          </button>
          {remindOpen && (
            <div className="absolute z-20 left-0 mt-1 w-40 rounded-md border border-white/10 bg-surface shadow-xl py-1 text-xs">
              {[
                { d: 7, l: "in 1 week" },
                { d: 30, l: "in 1 month" },
                { d: 90, l: "in 3 months" },
                { d: 180, l: "in 6 months" },
              ].map((p) => (
                <button
                  key={p.d}
                  type="button"
                  onClick={() => setReminder(p.d, p.l)}
                  className="w-full text-left px-3 py-1.5 hover:bg-white/[0.05] text-white"
                >
                  {p.l}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={draftOutreach}
          disabled={draftLoading}
          className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
        >
          {draftLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
          Draft outreach
        </button>
        {signal.report_url && (
          <a
            href={signal.report_url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="w-3 h-3" /> Report
          </a>
        )}
        <button
          type="button"
          onClick={() => onSnooze(signal.id)}
          title="Hide from today's feed"
          className="ml-auto text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:text-white"
        >
          <EyeOff className="w-3 h-3" /> Hide
        </button>
      </div>

      {(draftText || draftError) && (
        <div className="bg-black/30 border border-primary/30 rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-primary font-mono">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Draft
            </span>
            {draftText && (
              <button
                type="button"
                onClick={copyDraft}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"
              >
                {draftCopied ? <Check className="w-3 h-3" /> : <ClipboardCopy className="w-3 h-3" />}
                {draftCopied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          {draftError ? (
            <div className="text-xs text-destructive">{draftError}</div>
          ) : (
            <pre className="text-xs text-white whitespace-pre-wrap font-sans leading-relaxed">{draftText}</pre>
          )}
        </div>
      )}
    </div>
  );
}
